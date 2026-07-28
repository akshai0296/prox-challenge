import type { Artifact, Citation, CoreAgentResponse, WeldingProcess } from "../src/types.js";
import { connections, dutyRecords, processGuide, settingsGuides } from "./product-data.js";
import { getManualPage } from "./retrieval.js";

type ChecklistArtifact = Extract<Artifact, { type: "checklist" }>;
type SettingsArtifact = Extract<Artifact, { type: "settings-configurator" }>;

function citationKey(citation: Pick<Citation, "document" | "page">) {
  return `${citation.document}:${citation.page}`;
}

function artifactKey(artifact: Artifact) {
  if (artifact.type === "manual-page") return `${artifact.type}:${artifact.document}:${artifact.page}`;
  if (artifact.type === "duty-cycle") return `${artifact.type}:${artifact.process}:${artifact.voltage}`;
  if (artifact.type === "connection") return `${artifact.type}:${artifact.process}`;
  if (artifact.type === "checklist") return `${artifact.type}:${artifact.title}`;
  if (artifact.type === "process-guide") return `${artifact.type}:${artifact.recommended}`;
  if (artifact.type === "settings-configurator") return `${artifact.type}:${artifact.process ?? "unset"}`;
  return `${artifact.type}:${artifact.question}`;
}

export class GroundingLedger {
  readonly toolNames = new Set<string>();
  readonly citations = new Map<string, Citation>();
  readonly evidencePayloads: unknown[] = [];
  readonly toolPayloads = new Map<string, unknown[]>();
  readonly verifiedArtifacts: Artifact[] = [];
  readonly comparedProcesses = new Set<WeldingProcess>();

  record(
    toolName: string,
    payload: unknown,
    citations: Citation[] = [],
    artifacts: Artifact[] = []
  ) {
    this.toolNames.add(toolName);
    this.evidencePayloads.push(payload);
    const toolEntries = this.toolPayloads.get(toolName) ?? [];
    toolEntries.push(payload);
    this.toolPayloads.set(toolName,toolEntries);
    for (const citation of citations) {
      if (getManualPage(citation.document,citation.page)) {
        this.citations.set(citationKey(citation),citation);
      }
    }
    this.verifiedArtifacts.push(...artifacts);
  }

  recordComparedProcesses(processes: WeldingProcess[]) {
    for (const process of processes) this.comparedProcesses.add(process);
  }

  hasCitation(document: Citation["document"], page: number) {
    return this.citations.has(`${document}:${page}`);
  }

  evidenceText() {
    return JSON.stringify(this.evidencePayloads).toLowerCase();
  }

  payloadsFor(toolName: string) {
    return this.toolPayloads.get(toolName) ?? [];
  }
}

function verifiedProcessGuide(
  recommended: WeldingProcess,
  comparedProcesses: Set<WeldingProcess>
): Extract<Artifact, { type: "process-guide" }> | undefined {
  if (!comparedProcesses.has(recommended)) return undefined;
  const guide = processGuide[recommended];
  const alternatives = [...comparedProcesses]
    .filter(process => process !== recommended)
    .slice(0,3)
    .map(process => `${process}: ${processGuide[process].tradeoffs[0]}`);
  return {
    type:"process-guide",
    recommended,
    reasons:[
      `${recommended} is rated ${guide.skill.toLowerCase()} skill in the supplied chart.`,
      `${guide.gas}.`,
      `Published material range: ${guide.thickness}.`,
      ...guide.strengths.slice(0,2)
    ],
    alternatives,
    source:"How to Choose a Welder visual chart"
  };
}

export function verifiedSettingsArtifact(
  values: Pick<SettingsArtifact, "process" | "voltage" | "material" | "thickness" | "consumable" | "gas">
): SettingsArtifact {
  if (!values.process) {
    return {
      type:"settings-configurator",
      ...values,
      requiredInputs:["Process","Input voltage","Material","Material thickness","Consumable"],
      machineOutputs:["Process-specific Auto Weld recommendation"],
      sourcePage:20,
      warning:"Choose the process first. Polarity, gas, consumable, and available output controls change by process."
    };
  }
  const guide = settingsGuides[values.process];
  return {
    type:"settings-configurator",
    ...values,
    requiredInputs:guide.requiredInputs,
    machineOutputs:guide.machineOutputs,
    sourcePage:guide.page,
    warning:guide.warning
  };
}

function canonicalArtifact(
  artifact: Artifact,
  ledger: GroundingLedger,
  usedChecklistIndexes: Set<number>
): Artifact | undefined {
  if (artifact.type === "manual-page") {
    if (!ledger.hasCitation(artifact.document,artifact.page)) return undefined;
    return artifact;
  }
  if (artifact.type === "duty-cycle") {
    if (!ledger.toolNames.has("lookup_duty_cycle")) return undefined;
    const process = artifact.process === "Flux-core" ? "MIG" : artifact.process;
    const record = dutyRecords.find(item => item.process === process && item.voltage === artifact.voltage);
    if (!record) return undefined;
    return {
      ...artifact,
      ratings:record.ratings,
      selectedAmps:record.ratings.some(item => item.amps === artifact.selectedAmps)
        ? artifact.selectedAmps
        : record.ratings[0].amps
    };
  }
  if (artifact.type === "connection") {
    if (!ledger.toolNames.has("lookup_connections")) return undefined;
    const verified = connections[artifact.process];
    return {
      ...artifact,
      title:`${artifact.process} connection schematic`,
      connections:verified.connections,
      warning:verified.warning
    };
  }
  if (artifact.type === "checklist") {
    const checklists = ledger.verifiedArtifacts.filter(
      (candidate): candidate is ChecklistArtifact => candidate.type === "checklist"
    );
    const preferredIndex = checklists.findIndex((candidate,index) =>
      !usedChecklistIndexes.has(index) &&
      (candidate.title.toLowerCase().includes("wire") === artifact.title.toLowerCase().includes("wire"))
    );
    const index = preferredIndex >= 0
      ? preferredIndex
      : checklists.findIndex((_,candidateIndex) => !usedChecklistIndexes.has(candidateIndex));
    if (index < 0) return undefined;
    usedChecklistIndexes.add(index);
    return checklists[index];
  }
  if (artifact.type === "process-guide") {
    if (!ledger.toolNames.has("compare_processes")) return undefined;
    return verifiedProcessGuide(artifact.recommended,ledger.comparedProcesses);
  }
  if (artifact.type === "settings-configurator") {
    if (!ledger.toolNames.has("lookup_settings_workflow")) return undefined;
    return verifiedSettingsArtifact(artifact);
  }
  return undefined;
}

function validateCriticalClaims(answer: string, ledger: GroundingLedger) {
  const evidence = ledger.evidenceText();
  const evidenceNumbers = new Set(evidence.match(/\b\d+(?:\.\d+)?\b/g) ?? []);
  const numericClaims = answer.match(/\b\d+(?:\.\d+)?\b/g) ?? [];
  for (const claim of numericClaims) {
    if (!evidenceNumbers.has(claim)) {
      throw new Error(`Ungrounded numeric claim in agent answer: ${claim}`);
    }
  }
  for (const term of ["dcen","dcep","scfh","ipm"]) {
    if (answer.toLowerCase().includes(term) && !evidence.includes(term)) {
      throw new Error(`Ungrounded technical claim in agent answer: ${term.toUpperCase()}`);
    }
  }
}

function verifiedClarification(artifacts: Artifact[], ledger: GroundingLedger) {
  const settings = artifacts.find(
    (artifact): artifact is SettingsArtifact => artifact.type === "settings-configurator"
  );
  if (settings) {
    const missing = [
      !settings.process && "process",
      !settings.voltage && "input voltage",
      !settings.material.trim() && "material",
      !settings.thickness.trim() && "material thickness",
      !settings.consumable.trim() && "consumable",
      (settings.process === "MIG" || settings.process === "TIG") &&
        !settings.gas.trim() &&
        "shielding gas"
    ].filter(Boolean);
    const question = `Complete the ${missing.join(", ") || "remaining setup inputs"} in the configurator.`;
    return {
      type:"clarification" as const,
      question,
      options:["MIG setup","Flux-core setup","TIG setup","Stick setup"]
    };
  }

  const connection = artifacts.find(artifact => artifact.type === "connection");
  if (connection?.type === "connection" && connection.process === "Stick") {
    return {
      type:"clarification" as const,
      question:"What electrode classification is printed on the electrode package?",
      options:["I know the classification","I need help finding it"]
    };
  }

  if (
    ledger.toolNames.has("lookup_diagnostic") &&
    !artifacts.some(artifact => artifact.type === "checklist")
  ) {
    return {
      type:"clarification" as const,
      question:"Are you using gas-shielded solid-wire MIG or self-shielded flux-core?",
      options:["Gas-shielded MIG","Self-shielded flux-core"]
    };
  }

  return {
    type:"clarification" as const,
    question:"Which process, input voltage, material, thickness, consumable, and shielding gas are you using?",
    options:["MIG","Flux-core","TIG","Stick"]
  };
}

function verifiedNarrative(
  artifacts: Artifact[],
  citations: Citation[],
  ledger: GroundingLedger,
  needsClarification: boolean
) {
  const clarification = artifacts.find(artifact => artifact.type === "clarification");
  if (needsClarification && clarification?.type === "clarification") {
    return {
      answer:clarification.question,
      followUp:clarification.question
    };
  }

  const duty = artifacts.find(artifact => artifact.type === "duty-cycle");
  if (duty?.type === "duty-cycle") {
    const rating = duty.ratings.find(item => item.amps === duty.selectedAmps) ?? duty.ratings[0];
    const timing = rating.percent === 100
      ? "This is the published continuous-use point."
      : `That allows ${rating.weldMinutes} minutes of welding followed by ${rating.restMinutes} minutes of rest in each 10-minute period.`;
    return {
      answer:`At ${rating.amps} A on ${duty.voltage} V in ${duty.process} mode, the published duty cycle is ${rating.percent}%. ${timing}`,
      followUp:"Do you want the verified polarity and cable setup for this process?"
    };
  }

  const connection = artifacts.find(artifact => artifact.type === "connection");
  if (connection?.type === "connection") {
    const routing = connection.connections
      .map(item => `${item.label}: ${item.terminal}. ${item.note}`)
      .join(" ");
    return {
      answer:`Verified ${connection.process} connection routing: ${routing} ${connection.warning}`,
      followUp:"Do you want the cited manual page alongside this schematic?"
    };
  }

  const checklist = artifacts.find(artifact => artifact.type === "checklist");
  if (checklist?.type === "checklist") {
    return {
      answer:`Use the verified ${checklist.title.toLowerCase()} below and work through its checks in order. ${checklist.safety}`,
      followUp:"Which check fails first?"
    };
  }

  const guide = artifacts.find(artifact => artifact.type === "process-guide");
  if (guide?.type === "process-guide") {
    return {
      answer:`The supplied selection chart points to ${guide.recommended}. ${guide.reasons.join(" ")}`,
      followUp:"What material and exact thickness are you welding?"
    };
  }

  const settings = artifacts.find(
    (artifact): artifact is SettingsArtifact => artifact.type === "settings-configurator"
  );
  if (settings) {
    return {
      answer:`Use the verified Auto Weld workflow in the configurator. Supply ${settings.requiredInputs.join(", ")}. The machine then provides ${settings.machineOutputs.join(" and ")}. ${settings.warning}`,
      followUp:"Apply the remaining inputs in the configurator."
    };
  }

  const searches = ledger.payloadsFor("search_manual")
    .flatMap(payload => Array.isArray(payload) ? payload : [payload]);
  const excerpt = searches.find(
    (payload): payload is {excerpt:string} =>
      Boolean(payload) &&
      typeof payload === "object" &&
      "excerpt" in payload &&
      typeof payload.excerpt === "string"
  )?.excerpt;
  if (excerpt) {
    return {
      answer:`The most relevant supplied-document excerpt is: ${excerpt.slice(0,620)}`,
      followUp:"Open the cited page below for its full context and visual."
    };
  }

  return {
    answer:`I found ${citations.length} verified source page${citations.length === 1 ? "" : "s"}. Open the cited visual below for the manufacturer guidance.`,
    followUp:"What exact product detail should I narrow down?"
  };
}

export function canonicalizeGroundedResponse(
  response: CoreAgentResponse,
  ledger: GroundingLedger
): CoreAgentResponse {
  if (!ledger.toolNames.size) throw new Error("Technical response used no product tool");
  if (!ledger.toolNames.has("search_manual")) {
    throw new Error("Technical response did not search the supplied documents");
  }
  validateCriticalClaims(response.answer,ledger);

  let citations = response.citations
    .filter(item => ledger.hasCitation(item.document,item.page))
    .map(item => ledger.citations.get(citationKey(item)) as Citation);
  if (!citations.length && ledger.citations.size) citations = [...ledger.citations.values()].slice(0,4);

  const usedChecklistIndexes = new Set<number>();
  let artifacts = response.artifacts
    .map(artifact => canonicalArtifact(artifact,ledger,usedChecklistIndexes))
    .filter((artifact): artifact is Artifact => Boolean(artifact));

  if (response.needsClarification) {
    artifacts.push(verifiedClarification(artifacts,ledger));
  }
  if (!artifacts.some(artifact => artifact.type !== "clarification")) {
    artifacts.push(...ledger.verifiedArtifacts.slice(0,2));
  }
  if (!artifacts.some(artifact => artifact.type === "manual-page") && citations[0]) {
    artifacts.push({
      type:"manual-page",
      document:citations[0].document,
      page:citations[0].page,
      caption:citations[0].title
    });
  }

  const deduplicated = new Map<string, Artifact>();
  for (const artifact of artifacts) deduplicated.set(artifactKey(artifact),artifact);
  artifacts = [...deduplicated.values()].slice(0,6);

  if (!response.needsClarification && !citations.length) {
    throw new Error("Grounded technical response has no verified citation");
  }
  if (response.needsClarification) {
    if (!artifacts.some(artifact => artifact.type === "clarification")) {
      throw new Error("Clarification response has no interactive choices");
    }
  }

  const narrative = verifiedNarrative(artifacts,citations,ledger,response.needsClarification);
  return { ...response, ...narrative, citations, artifacts };
}
