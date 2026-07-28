import type { Artifact, Citation, CoreAgentResponse, WeldingProcess } from "../src/types.js";
import { verifiedSettingsArtifact } from "./grounding.js";
import { connections, diagnostics, dutyRecords, normalizeProcess, processGuide } from "./product-data.js";
import { searchManual } from "./retrieval.js";

type HistoryItem = { role?: string; content?: string };

const citation = (
  page: number,
  title: string,
  document: Citation["document"] = "owner-manual"
): Citation => ({ document, page, title });

const manualPage = (
  page: number,
  caption: string,
  document: Citation["document"] = "owner-manual"
): Artifact => ({ type:"manual-page", document, page, caption });

function clarification(question: string, options: string[]): CoreAgentResponse {
  return {
    answer: question,
    citations: [],
    artifacts: [{ type:"clarification", question, options }],
    needsClarification: true,
    followUp: question
  };
}

function userHistory(history: HistoryItem[]): string[] {
  return history
    .filter(item => item.role === "user" && typeof item.content === "string")
    .map(item => item.content as string)
    .slice(-6);
}

function firstMatch<T>(texts: string[], parser: (text: string) => T | undefined): T | undefined {
  for (const text of texts) {
    const value = parser(text);
    if (value !== undefined) return value;
  }
  return undefined;
}

function detectVoltage(text: string): 120 | 240 | undefined {
  if (/\b240\s*(?:v|volt|vac)\b/i.test(text)) return 240;
  if (/\b120\s*(?:v|volt|vac)\b/i.test(text)) return 120;
  return undefined;
}

function detectAmps(text: string): number | undefined {
  const match = text.match(/\b(\d{2,3})\s*(?:a|amps?|amperes?)\b/i);
  return match ? Number(match[1]) : undefined;
}

function detectMaterial(text: string): string {
  if (/\bchrome.?moly\b/i.test(text)) return "Chrome moly";
  if (/\bstainless\b/i.test(text)) return "Stainless steel";
  if (/\baluminum\b/i.test(text)) return "Aluminum";
  if (/\bcast(?:ing| iron)?\b/i.test(text)) return "Casting";
  if (/\b(?:mild )?steel\b/i.test(text)) return "Mild steel";
  return "";
}

function detectThickness(text: string): string {
  const match = text.match(/\b(?:\d+\s*(?:ga|gauge)|\d+(?:\/\d+)?\s*(?:in|inch(?:es)?|"))\b/i);
  return match?.[0] ?? "";
}

function detectConsumable(text: string): string {
  const wire = text.match(/\b0?\.\d{3}\s*(?:"|in)?\s*(?:solid|flux(?:-cored)?)?\s*wire\b/i);
  if (wire) return wire[0];
  const electrode = text.match(/\b(?:E\d{4}|electrode\s+(?:type|classification)\s+\S+)\b/i);
  return electrode?.[0] ?? "";
}

function detectGas(text: string): string {
  if (/\b(?:c25|75\s*%?\s*argon\s*[/+]\s*25\s*%?\s*(?:co2|carbon dioxide))\b/i.test(text)) {
    return "75% argon / 25% CO2";
  }
  if (/\b100\s*%?\s*argon\b/i.test(text)) return "100% argon";
  if (/\b100\s*%?\s*(?:co2|carbon dioxide)\b/i.test(text)) return "100% CO2";
  return "";
}

function displayProcess(process: WeldingProcess) {
  return process === "Flux-core" ? "self-shielded flux-core" : process;
}

function dutyAnswer(
  process: WeldingProcess | undefined,
  voltage: 120 | 240 | undefined,
  amps: number | undefined
): CoreAgentResponse {
  if (!process) return clarification("Which welding process are you using?", ["MIG", "Flux-core", "TIG", "Stick"]);
  if (!voltage) return clarification("Which input supply are you using?", ["120 V", "240 V"]);
  const recordProcess = process === "Flux-core" ? "MIG" : process;
  const record = dutyRecords.find(item => item.process === recordProcess && item.voltage === voltage);
  if (!record) return clarification("I could not resolve that duty-cycle combination. Which process are you using?", ["MIG", "TIG", "Stick"]);
  const artifact: Artifact = {
    type:"duty-cycle",
    process,
    voltage,
    ratings:record.ratings,
    selectedAmps:amps && record.ratings.some(item => item.amps === amps) ? amps : record.ratings[0].amps
  };
  const sourcePage = record.page;
  const exact = amps ? record.ratings.find(item => item.amps === amps) : undefined;
  if (!amps) {
    const points = record.ratings.map(item => `${item.percent}% at ${item.amps} A`).join(" and ");
    return {
      answer:`For ${displayProcess(process)} on ${voltage} V, the manual gives two rated points: ${points}. Tell me the output current you plan to use. I will not invent an interpolated duty cycle.`,
      citations:[citation(7,"Rated specifications"),citation(sourcePage,"Duty-cycle chart")],
      artifacts:[artifact,manualPage(sourcePage,`${process} duty-cycle chart`)],
      needsClarification:true,
      followUp:"What output amperage are you planning to use?"
    };
  }
  if (amps < record.range[0] || amps > record.range[1]) {
    return {
      answer:`${amps} A is outside the ${record.range[0]}–${record.range[1]} A output range listed for ${displayProcess(process)} on ${voltage} V. Do not use that requested setting.`,
      citations:[citation(7,"Welding-current ranges")],
      artifacts:[artifact,manualPage(7,"Specifications and welding-current ranges")],
      needsClarification:false,
      followUp:`Choose an output within ${record.range[0]}–${record.range[1]} A.`
    };
  }
  if (!exact) {
    const points = record.ratings.map(item => `${item.percent}% at ${item.amps} A`).join(" and ");
    return {
      answer:`The manual does not publish an exact duty cycle for ${amps} A in ${displayProcess(process)} mode on ${voltage} V. Its verified points are ${points}. Duty cycle should not be estimated by linear interpolation because the manual does not authorize that calculation.`,
      citations:[citation(7,"Rated specifications"),citation(sourcePage,"Duty-cycle chart")],
      artifacts:[artifact,manualPage(sourcePage,`${process} duty-cycle chart`)],
      needsClarification:false,
      followUp:"Use the machine's thermal protection as a backstop, not as a substitute for the rated limits."
    };
  }
  const cooling = exact.restMinutes
    ? `Weld for no more than ${exact.weldMinutes} minute${exact.weldMinutes === 1 ? "" : "s"} in each 10-minute window, then rest for at least ${exact.restMinutes} minutes.`
    : "This is the manual's 100% continuous-use rating.";
  return {
    answer:`At ${amps} A on ${voltage} V in ${displayProcess(process)} mode, the rated duty cycle is ${exact.percent}%. ${cooling} If thermal protection activates, leave the power on so the internal fan can cool the machine.`,
    citations:[citation(7,"Rated specifications"),citation(sourcePage,"Duty-cycle chart")],
    artifacts:[artifact,manualPage(sourcePage,`${process} rated duty cycles`)],
    needsClarification:false,
    followUp:"Do you want the corresponding polarity or setup steps?"
  };
}

function connectionAnswer(process: WeldingProcess | undefined): CoreAgentResponse {
  if (!process) return clarification("Which process or consumable are you connecting?", ["Solid-wire MIG", "Self-shielded flux-core", "TIG", "Stick"]);
  const setup = connections[process];
  return {
    answer:`${setup.summary} ${setup.connections.map(item => `${item.label}: ${item.terminal}.`).join(" ")} ${setup.warning}`,
    citations:[
      citation(setup.page,`${process} physical cable setup`),
      ...setup.supportingPages.map(page => citation(page,`${process} operating-screen setup`))
    ],
    artifacts:[
      { type:"connection", title:`${process} connection map`, process, connections:setup.connections, warning:setup.warning },
      manualPage(setup.page,`${process} physical cable layout`),
      ...setup.supportingPages.map(page => manualPage(page,`${process} operating-screen setup`))
    ],
    needsClarification:process === "Stick",
    followUp:process === "Stick" ? "What electrode classification are you using?" : "Do you want the operating sequence after the cables are connected?"
  };
}

function porosityAnswer(process: WeldingProcess | undefined): CoreAgentResponse {
  if (!process) return clarification(
    "Porosity checks differ between gas-shielded MIG and self-shielded flux-core. Which are you running?",
    ["Gas-shielded MIG", "Self-shielded flux-core"]
  );
  if (process !== "MIG" && process !== "Flux-core") {
    const results = searchManual(`${process} weld porosity`, { limit:3 });
    return {
      answer:`The supplied wire-weld porosity checklist is for MIG and flux-core. For ${process}, I found the cited diagnosis pages below, but I need the exact weld symptom before prescribing a correction.`,
      citations:results.map(result => citation(result.page,`${result.documentTitle}: weld diagnosis`,result.document)),
      artifacts:results.slice(0,2).map(result => manualPage(result.page,"Relevant weld-diagnosis page",result.document)),
      needsClarification:true,
      followUp:"Are you seeing small cavities, slag inclusions, cracking, or another defect?"
    };
  }
  const diagnostic = diagnostics.find(item => item.symptom === "porosity" && item.process === process)!;
  return {
    answer:`For ${displayProcess(process)} porosity, work through these checks in order and change one variable at a time. ${process === "MIG" ? "Start with gas delivery, contamination, CTWD, and DCEP polarity." : "Start with contamination, CTWD, travel consistency, feed condition, and DCEN polarity. Shielding-gas adjustments do not apply to self-shielded wire."}`,
    citations:[citation(37,"Wire-weld porosity causes"),citation(43,"Porosity troubleshooting matrix")],
    artifacts:[
      { type:"checklist", title:`${process} porosity diagnostic`, items:diagnostic.items, safety:diagnostic.safety },
      manualPage(37,"Wire-weld porosity diagnosis")
    ],
    needsClarification:false,
    followUp:"Which check fails, or what changed immediately before the porosity appeared?"
  };
}

function wireFeedAnswer(tensionOnly: boolean): CoreAgentResponse {
  if (tensionOnly) {
    const items = [
      { check:"Starting setting", action:"Use 3–5 for solid wire and 2–3 for flux-cored wire." },
      { check:"Wood-block test", action:"Hold the gun 2–3 inches from wood and trigger for less than three seconds." },
      { check:"Final adjustment", action:"Increase pressure gradually only until the wire bends instead of slipping." }
    ];
    return {
      answer:"Set feed tension to 3–5 for solid wire or 2–3 for flux-cored wire. For the page-17 wood-block test, hold the gun 2–3 inches away and trigger for less than three seconds. Stop tightening as soon as the wire bends. Excess pressure can crush tubular flux-cored wire.",
      citations:[citation(15,"Wire loading and tension"),citation(17,"Drive-tension test")],
      artifacts:[
        { type:"checklist", title:"Set wire-feed tension", items, safety:"Keep the gun clear of grounded objects while feeding wire. Trigger for less than three seconds during the test." },
        manualPage(17,"Wire drive-tension test")
      ],
      needsClarification:false,
      followUp:"Is the motor running while the wire slips, or is the motor not running?"
    };
  }
  const diagnostic = diagnostics.find(item => item.symptom === "wire feed")!;
  return {
    answer:"A feed failure is not automatically a tension problem. First identify whether the motor runs. Then inspect pressure, roller size, liner condition, spool tangles, connector seating, and contact-tip size in the order shown.",
    citations:[citation(42,"MIG / flux-core troubleshooting"),citation(17,"Drive-tension test")],
    artifacts:[
      { type:"checklist", title:"Wire-feed fault isolation", items:diagnostic.items, safety:diagnostic.safety },
      manualPage(42,"Wire-feed troubleshooting matrix")
    ],
    needsClarification:true,
    followUp:"When you pull the trigger, does the feed motor run?"
  };
}

function processSelectionAnswer(text: string): CoreAgentResponse {
  const lower = text.toLowerCase();
  let recommended: WeldingProcess | undefined;
  const reasons: string[] = [];
  const alternatives: string[] = [];
  if (/\b(outdoor|outside|windy|no gas|without gas)\b/.test(lower)) {
    recommended = /\b(thick|1\/2|half.inch|casting)\b/.test(lower) ? "Stick" : "Flux-core";
    reasons.push("The selection chart favors gasless processes outdoors or in wind.");
    alternatives.push(recommended === "Stick" ? "Flux-core for faster wire welding on thinner steel" : "Stick for thicker material and deeper penetration");
  } else if (/\b(precise|cleanest|aesthetic|bicycle|thin wall|stainless exhaust)\b/.test(lower)) {
    recommended = "TIG";
    reasons.push("The selection chart rates TIG highest for clean, precise, high-quality welds.");
    alternatives.push("MIG for faster production with less required skill");
  } else if (/\b(beginner|easy|fast|automotive|sheet metal|body panel|thin steel)\b/.test(lower)) {
    recommended = "MIG";
    reasons.push("The selection chart calls MIG the easiest process to learn and strong for thin material.");
    alternatives.push("Flux-core when shielding gas or indoor conditions are unavailable");
  }
  if (!recommended) return clarification(
    "To choose a process, tell me the material, thickness, whether you are indoors or outdoors, and whether shielding gas is available.",
    ["Beginner, thin steel, indoors", "Outdoor steel without gas", "Thick or dirty steel", "Precise stainless work"]
  );
  const guide = processGuide[recommended];
  reasons.push(`${recommended} covers ${guide.thickness} in the supplied selection chart.`);
  return {
    answer:`Start with ${recommended}. ${reasons.join(" ")} Main tradeoff: ${guide.tradeoffs.join("; ").toLowerCase()}.`,
    citations:[citation(1,"How to Choose a Welder","selection-chart")],
    artifacts:[
      { type:"process-guide", recommended, reasons, alternatives, source:"How to Choose a Welder visual chart" },
      manualPage(1,"Visual welding-process selection chart","selection-chart")
    ],
    needsClarification:false,
    followUp:"What material and exact thickness are you welding?"
  };
}

function settingsAnswer(
  process: WeldingProcess | undefined,
  voltage: 120 | 240 | undefined,
  text: string
): CoreAgentResponse {
  const material = detectMaterial(text);
  const thickness = detectThickness(text);
  const consumable = detectConsumable(text);
  const gas = detectGas(text);
  const configurator = verifiedSettingsArtifact({
    process:process ?? null,
    voltage:voltage ?? null,
    material,
    thickness,
    consumable,
    gas
  });
  const missing = [
    !process && "process",
    !voltage && "input voltage",
    !material && "material",
    !thickness && "thickness",
    !consumable && "consumable",
    (process === "MIG" || process === "TIG") && !gas && "shielding gas"
  ].filter(Boolean);
  if (missing.length) {
    const question = `Set the missing ${missing.join(", ")} in the configurator. The OmniPro's Auto Weld screen calculates or marks its recommendation only after the required inputs and consumable are selected.`;
    return {
      answer:question,
      citations:process
        ? [citation(configurator.sourcePage,`${process} Auto Weld settings`)]
        : [
            citation(20,"Wire Auto Weld settings"),
            citation(30,"TIG Auto Weld settings"),
            citation(32,"Stick Auto Weld settings")
          ],
      artifacts:[
        configurator,
        {
          type:"clarification",
          question,
          options:["MIG setup","Flux-core setup","TIG setup","Stick setup"]
        }
      ],
      needsClarification:true,
      followUp:question
    };
  }
  const page = configurator.sourcePage;
  return {
    answer:`For ${process} on ${voltage} V, use the OmniPro Auto Weld workflow: select the process, consumable diameter, material thickness, gas or electrode as applicable, then review the machine-generated output before welding scrap. The supplied manual does not publish enough numeric values to safely invent a wire-speed or voltage pair.`,
    citations:[citation(page,`${process} Auto Weld settings`)],
    artifacts:[configurator,manualPage(page,`${process} Auto Weld control sequence`)],
    needsClarification:false,
    followUp:"What consumable diameter and gas or electrode classification are you using?"
  };
}

export function runOfflineAgent(
  message: string,
  history: HistoryItem[] = []
): CoreAgentResponse {
  const current = message.trim();
  const previous = userHistory(history).filter(text => text !== current).reverse();
  const contextTexts = [current, ...previous];
  const context = contextTexts.join(" ");
  const lower = context.toLowerCase();
  const process = firstMatch(contextTexts, normalizeProcess);
  const voltage = firstMatch(contextTexts, detectVoltage);
  const amps = firstMatch(contextTexts, detectAmps);

  if (/\bduty(?:\s+cycle)?\b|overheat|how long (?:can|may) i weld/.test(lower)) {
    return dutyAnswer(process, voltage, amps);
  }
  if (/porosity|small cavit|bubbles? in (?:the )?weld/.test(lower)) {
    return porosityAnswer(process);
  }
  if (/polar|which socket|connect(?:ion)?|ground clamp/.test(lower) && process) {
    return connectionAnswer(process);
  }
  if (/wire.{0,20}(?:not|won't|wont|stops?|fails?).{0,20}feed|feed.{0,20}(?:problem|fail|stop)|bird.?nest|liner|feed roller/.test(lower)) {
    return wireFeedAnswer(false);
  }
  if (/feed tension|tensioner|drive tension/.test(lower)) {
    return wireFeedAnswer(true);
  }
  if (/which (?:welding )?process|choose (?:a )?process|best process|outdoor welding|weld outside/.test(lower)) {
    return processSelectionAnswer(current);
  }
  if (/recommended settings|what settings|wire speed|set(?:up)? voltage|how should i set/.test(lower)) {
    return settingsAnswer(process, voltage, context);
  }
  if (/polar|which socket|connect(?:ion)?|ground clamp/.test(lower)) {
    return connectionAnswer(undefined);
  }

  const results = searchManual(current, { limit:3 });
  if (!results.length) {
    return clarification(
      "I could not ground that question in the supplied product documents. Rephrase it with the process and symptom or setting.",
      ["Ask about duty cycle", "Ask about polarity", "Diagnose a weld defect", "Choose a welding process"]
    );
  }
  return {
    answer:`I found the most relevant manual sections, but the offline reasoner does not have enough structured evidence to turn them into a safe prescriptive answer. The strongest match says: ${results[0].excerpt}`,
    citations:results.map(result => citation(result.page,result.documentTitle,result.document)),
    artifacts:results.slice(0,2).map(result => manualPage(result.page,"Relevant source page",result.document)),
    needsClarification:true,
    followUp:"What welding process, input voltage, material, and exact symptom are involved?"
  };
}
