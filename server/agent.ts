import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type {
  Artifact, Citation, CoreAgentResponse, DocumentId, WeldingProcess
} from "../src/types.js";
import { CoreAgentResponseSchema, responseJsonSchema } from "./contract.js";
import {
  canonicalizeGroundedResponse, GroundingLedger, verifiedSettingsArtifact
} from "./grounding.js";
import {
  connections, diagnostics, dutyRecords, normalizeProcess, processGuide, settingsGuides
} from "./product-data.js";
import { getManualPage, searchManual } from "./retrieval.js";

function result(value: unknown) {
  return {
    content: [{ type:"text" as const, text:JSON.stringify(value, null, 2) }]
  };
}

function citation(document: DocumentId, page: number, title: string): Citation {
  return { document, page, title };
}

function manualArtifact(document: DocumentId, page: number, caption: string): Artifact {
  return { type:"manual-page", document, page, caption };
}

function createProductServer(ledger: GroundingLedger) {
  const searchManualTool = tool(
    "search_manual",
    "Search all supplied OmniPro 220 documents. Use this before answering any technical, safety, troubleshooting, settings, or operating question. Returns page-numbered excerpts and visual asset paths.",
    {
      query: z.string().min(2).max(500),
      document: z.enum(["owner-manual","quick-start","selection-chart"]).optional(),
      limit: z.number().int().min(1).max(8).optional()
    },
    async ({ query: searchQuery, document, limit }) => {
      const matches = searchManual(searchQuery, {
        document: document as DocumentId | undefined,
        limit
      });
      const citations = matches.map(match =>
        citation(match.document,match.page,match.documentTitle)
      );
      ledger.record(
        "search_manual",
        matches,
        citations,
        matches.slice(0,2).map(match =>
          manualArtifact(match.document,match.page,`Relevant ${match.documentTitle} page`)
        )
      );
      return result(matches);
    }
  );

  const dutyCycleTool = tool(
    "lookup_duty_cycle",
    "Look up exact manufacturer-rated duty-cycle points and current ranges. Never interpolate between rated points.",
    {
      process: z.enum(["MIG","Flux-core","TIG","Stick"]),
      voltage: z.union([z.literal(120),z.literal(240)]),
      amperage: z.number().positive().optional()
    },
    async ({ process, voltage, amperage }) => {
      const recordProcess = process === "Flux-core" ? "MIG" : process;
      const record = dutyRecords.find(item => item.process === recordProcess && item.voltage === voltage);
      const payload = !record ? { found:false } : {
        found:true,
        requestedProcess:process,
        voltage,
        currentRange:record.range,
        ratings:record.ratings,
        requestedAmperage:amperage ?? null,
        exactRating:amperage === undefined
          ? null
          : record.ratings.find(item => item.amps === amperage) ?? null,
        instruction:amperage === undefined
          ? "Ask the user for amperage or present only the published rating points."
          : record.ratings.some(item => item.amps === amperage)
            ? "Use this exact rating."
            : "Do not calculate or interpolate a duty cycle for this amperage.",
        citations:[
          citation("owner-manual",7,"Rated specifications"),
          citation("owner-manual",record.page,"Duty-cycle chart")
        ]
      };
      const citations = record ? payload.citations : [];
      const artifacts: Artifact[] = record ? [{
        type:"duty-cycle",
        process,
        voltage,
        ratings:record.ratings,
        selectedAmps:record.ratings.some(item => item.amps === amperage)
          ? amperage as number
          : record.ratings[0].amps
      }] : [];
      ledger.record("lookup_duty_cycle",payload,citations,artifacts);
      return result(payload);
    }
  );

  const connectionTool = tool(
    "lookup_connections",
    "Return verified output-terminal, polarity, gas, and safety guidance for one welding process.",
    { process:z.enum(["MIG","Flux-core","TIG","Stick"]) },
    async ({ process }) => {
      const setup = connections[process];
      const citations = [
        citation("owner-manual",setup.page,`${process} physical cable setup`),
        ...setup.supportingPages.map(page =>
          citation("owner-manual",page,`${process} operating-screen setup`)
        )
      ];
      const artifact: Artifact = {
        type:"connection",
        title:`${process} connection schematic`,
        process,
        connections:setup.connections,
        warning:setup.warning
      };
      const payload = { process, ...setup, citations };
      ledger.record("lookup_connections",payload,citations,[artifact]);
      return result(payload);
    }
  );

  const diagnosticTool = tool(
    "lookup_diagnostic",
    "Return a process-specific verified troubleshooting checklist. For porosity, process is required because MIG gas checks do not apply to self-shielded flux-core.",
    {
      symptom:z.enum(["porosity","wire feed"]),
      process:z.enum(["MIG","Flux-core","TIG","Stick"]).optional()
    },
    async ({ symptom, process }) => {
      if (symptom === "porosity" && process !== "MIG" && process !== "Flux-core") {
        const payload = {
          found:false,
          clarification:"Ask whether the user is running gas-shielded MIG or self-shielded flux-core."
        };
        ledger.record("lookup_diagnostic",payload);
        return result(payload);
      }
      const diagnostic = diagnostics.find(item =>
        item.symptom === symptom && (item.process === "Any" || item.process === process)
      );
      if (!diagnostic) {
        const payload = {found:false};
        ledger.record("lookup_diagnostic",payload);
        return result(payload);
      }
      const citations = [
        citation("owner-manual",diagnostic.page,`${symptom} troubleshooting`)
      ];
      if (symptom === "wire feed" || process === "Flux-core") {
        citations.push(citation("owner-manual",17,"Drive-tension test"));
      }
      const artifact: Artifact = {
        type:"checklist",
        title:symptom === "wire feed"
          ? "Wire-feed fault isolation"
          : `${process} porosity diagnostic`,
        items:diagnostic.items,
        safety:diagnostic.safety
      };
      const payload = { found:true, ...diagnostic, citations };
      ledger.record("lookup_diagnostic",payload,citations,[artifact]);
      return result(payload);
    }
  );

  const processGuideTool = tool(
    "compare_processes",
    "Return the visual selection-chart facts for MIG, flux-core, TIG, and Stick. Use this to recommend a process from material, thickness, location, gas availability, skill, and finish priorities.",
    { processes:z.array(z.enum(["MIG","Flux-core","TIG","Stick"])).min(1).max(4).optional() },
    async ({ processes }) => {
      const selected = processes?.length ? processes : (Object.keys(processGuide) as WeldingProcess[]);
      const source = citation("selection-chart",1,"How to Choose a Welder");
      const payload = {
        processes:Object.fromEntries(selected.map(process => [process,processGuide[process]])),
        citation:source,
        visual:{
          type:"manual-page",
          document:"selection-chart",
          page:1,
          caption:"Visual welding-process selection chart"
        }
      };
      ledger.recordComparedProcesses(selected);
      ledger.record(
        "compare_processes",
        payload,
        [source],
        [manualArtifact("selection-chart",1,"Visual welding-process selection chart")]
      );
      return result(payload);
    }
  );

  const settingsTool = tool(
    "lookup_settings_workflow",
    "Return the verified interactive Auto Weld setup workflow. Use this for every settings question. It identifies required inputs and machine-generated outputs without inventing unpublished numeric settings.",
    {
      process:z.enum(["MIG","Flux-core","TIG","Stick"]).optional(),
      voltage:z.union([z.literal(120),z.literal(240)]).optional(),
      material:z.string().max(100).optional(),
      thickness:z.string().max(60).optional(),
      consumable:z.string().max(120).optional(),
      gas:z.string().max(120).optional()
    },
    async ({ process, voltage, material, thickness, consumable, gas }) => {
      const artifact = verifiedSettingsArtifact({
        process:process ?? null,
        voltage:voltage ?? null,
        material:material ?? "",
        thickness:thickness ?? "",
        consumable:consumable ?? "",
        gas:gas ?? ""
      });
      const sourceCitations = process
        ? [citation("owner-manual",settingsGuides[process].page,`${process} Auto Weld workflow`)]
        : [
            citation("owner-manual",20,"Wire Auto Weld workflow"),
            citation("owner-manual",30,"TIG Auto Weld workflow"),
            citation("owner-manual",32,"Stick Auto Weld workflow")
          ];
      const payload = {
        ...artifact,
        availableMaterials:process ? settingsGuides[process].materials : [],
        availableConsumables:process ? settingsGuides[process].consumables : [],
        instruction:"Let the machine calculate or mark the recommended output. Do not invent unpublished wire-speed, voltage, or amperage values.",
        citations:sourceCitations
      };
      ledger.record("lookup_settings_workflow",payload,sourceCitations,[artifact]);
      return result(payload);
    }
  );

  const pageTool = tool(
    "read_manual_page",
    "Read the complete extracted text of a known source page and get its pre-rendered visual path.",
    {
      document:z.enum(["owner-manual","quick-start","selection-chart"]),
      page:z.number().int().positive()
    },
    async ({ document, page }) => {
      const found = getManualPage(document as DocumentId, page);
      if (!found) {
        const payload = {found:false};
        ledger.record("read_manual_page",payload);
        return result(payload);
      }
      const imagePath = document === "owner-manual"
        ? `/manual/page-${page}.jpg`
        : document === "quick-start"
          ? `/quick-start/page-${page}.jpg`
          : "/reference/selection-chart.png";
      const source = citation(document as DocumentId,page,found.documentTitle);
      const payload = {found:true,...found,imagePath};
      ledger.record(
        "read_manual_page",
        payload,
        [source],
        [manualArtifact(document as DocumentId,page,found.documentTitle)]
      );
      return result(payload);
    }
  );

  return createSdkMcpServer({
    name:"product",
    version:"1.1.0",
    tools:[
      searchManualTool,
      dutyCycleTool,
      connectionTool,
      diagnosticTool,
      processGuideTool,
      settingsTool,
      pageTool
    ]
  });
}

const allowedTools = [
  "mcp__product__search_manual",
  "mcp__product__lookup_duty_cycle",
  "mcp__product__lookup_connections",
  "mcp__product__lookup_diagnostic",
  "mcp__product__compare_processes",
  "mcp__product__lookup_settings_workflow",
  "mcp__product__read_manual_page"
];

export const agentRuntimePolicy = Object.freeze({
  builtInTools: [] as string[],
  allowedTools:[...allowedTools]
});

const systemPrompt = `You are Arcsmith, a garage-side technical copilot for the Vulcan OmniPro 220.

Accuracy rules:
1. Call search_manual and at least one relevant structured product tool before every technical answer. Never answer product facts from memory.
2. Use lookup_duty_cycle for every duty-cycle question. Never interpolate between rated points.
3. Use lookup_settings_workflow for every settings question. Never invent numeric settings absent from the tool evidence.
4. Ask for process, input voltage, amperage, material, thickness, consumable, or gas when any is necessary and missing.
5. Distinguish gas-shielded solid-wire MIG from self-shielded flux-core. Their polarity and porosity checks differ.
6. For Stick polarity, require the electrode classification. Do not guess.
7. Cite only pages returned by tools. Cite printed PDF page numbers exactly.
8. Prefer a useful visual artifact over a long explanation. Use a manual-page, exact duty-cycle control, physical connection schematic, diagnostic checklist, process guide, settings configurator, or clarification choices.
9. Safety warnings must be direct. Never suggest servicing an energized machine.

Return only the structured response. Each artifact must use one of these exact forms:
- manual-page: document, page, caption
- duty-cycle: process, voltage, exact ratings array, selectedAmps
- connection: title, process, connections, warning
- checklist: title, items with check and action, safety
- process-guide: recommended, reasons, alternatives, source
- settings-configurator: process or null, voltage or null, material, thickness, consumable, gas, requiredInputs, machineOutputs, sourcePage, warning
- clarification: question, options

If clarification is needed, set needsClarification true, include a clarification artifact, and ask one precise follow-up. Otherwise set it false. followUp must always be a string, using an empty string if no follow-up is useful.`;

const sessions = new Map<string,string>();
const MAX_SESSIONS = 250;

async function executeAgent(message: string, resume?: string) {
  let output: CoreAgentResponse | undefined;
  let sessionId: string | undefined;
  let errors: string[] = [];
  const ledger = new GroundingLedger();
  for await (const event of query({
    prompt:message,
    options:{
      ...(resume ? {resume} : {}),
      model:process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
      systemPrompt,
      tools:agentRuntimePolicy.builtInTools,
      allowedTools:agentRuntimePolicy.allowedTools,
      mcpServers:{product:createProductServer(ledger)},
      permissionMode:"dontAsk",
      maxTurns:8,
      maxThinkingTokens:5000,
      maxBudgetUsd:0.20,
      outputFormat:{type:"json_schema",schema:responseJsonSchema}
    }
  })) {
    if (event.type === "result") {
      sessionId = event.session_id;
      if (event.subtype === "success" && event.structured_output) {
        const parsed = CoreAgentResponseSchema.safeParse(event.structured_output);
        if (parsed.success) {
          try {
            output = canonicalizeGroundedResponse(parsed.data,ledger);
          } catch (error) {
            errors.push(error instanceof Error ? error.message : String(error));
          }
        } else {
          errors.push(parsed.error.message);
        }
      } else if (event.subtype !== "success") {
        errors = event.errors;
      }
    }
  }
  if (!output || !sessionId) {
    throw new Error(errors.join("; ") || "Claude returned no valid grounded structured response");
  }
  return {output,sessionId};
}

export async function runClaudeAgent(message: string, conversationId: string): Promise<CoreAgentResponse> {
  const resume = sessions.get(conversationId);
  try {
    const completed = await executeAgent(message,resume);
    sessions.set(conversationId,completed.sessionId);
    if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
    return completed.output;
  } catch (error) {
    if (!resume) throw error;
    sessions.delete(conversationId);
    const completed = await executeAgent(message);
    sessions.set(conversationId,completed.sessionId);
    return completed.output;
  }
}

export function clearConversation(conversationId: string) {
  sessions.delete(conversationId);
}

export function inferProcess(value: string) {
  return normalizeProcess(value);
}
