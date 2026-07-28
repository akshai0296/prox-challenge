import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { CoreAgentResponse, DocumentId, WeldingProcess } from "../src/types.js";
import { CoreAgentResponseSchema, responseJsonSchema } from "./contract.js";
import { connections, diagnostics, dutyRecords, normalizeProcess, processGuide } from "./product-data.js";
import { getManualPage, searchManual } from "./retrieval.js";

function result(value: unknown) {
  return {
    content: [{ type:"text" as const, text:JSON.stringify(value, null, 2) }]
  };
}

const searchManualTool = tool(
  "search_manual",
  "Search all supplied OmniPro 220 documents. Use this before answering any technical, safety, troubleshooting, settings, or operating question. Returns page-numbered excerpts and visual asset paths.",
  {
    query: z.string().min(2).max(500),
    document: z.enum(["owner-manual","quick-start","selection-chart"]).optional(),
    limit: z.number().int().min(1).max(8).optional()
  },
  async ({ query: searchQuery, document, limit }) => result(searchManual(searchQuery, {
    document: document as DocumentId | undefined,
    limit
  }))
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
    if (!record) return result({ found:false });
    const exact = amperage === undefined ? undefined : record.ratings.find(item => item.amps === amperage);
    return result({
      found:true,
      requestedProcess:process,
      voltage,
      currentRange:record.range,
      ratings:record.ratings,
      requestedAmperage:amperage ?? null,
      exactRating:exact ?? null,
      instruction:exact
        ? "Use this exact rating."
        : amperage === undefined
          ? "Ask the user for amperage or present only the published rating points."
          : "Do not calculate or interpolate a duty cycle for this amperage.",
      citations:[{document:"owner-manual",page:7,title:"Rated specifications"},{document:"owner-manual",page:record.page,title:"Duty-cycle chart"}]
    });
  }
);

const connectionTool = tool(
  "lookup_connections",
  "Return verified output-terminal, polarity, gas, and safety guidance for one welding process.",
  { process:z.enum(["MIG","Flux-core","TIG","Stick"]) },
  async ({ process }) => result({
    process,
    ...connections[process],
    citation:{ document:"owner-manual", page:connections[process].page, title:`${process} connection setup` }
  })
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
      return result({
        found:false,
        clarification:"Ask whether the user is running gas-shielded MIG or self-shielded flux-core."
      });
    }
    const diagnostic = diagnostics.find(item =>
      item.symptom === symptom && (item.process === "Any" || item.process === process)
    );
    return result(diagnostic ? {
      found:true,
      ...diagnostic,
      citation:{document:"owner-manual",page:diagnostic.page,title:`${symptom} troubleshooting`}
    } : {found:false});
  }
);

const processGuideTool = tool(
  "compare_processes",
  "Return the visual selection-chart facts for MIG, flux-core, TIG, and Stick. Use this to recommend a process from material, thickness, location, gas availability, skill, and finish priorities.",
  { processes:z.array(z.enum(["MIG","Flux-core","TIG","Stick"])).min(1).max(4).optional() },
  async ({ processes }) => {
    const selected = processes?.length ? processes : (Object.keys(processGuide) as WeldingProcess[]);
    return result({
      processes:Object.fromEntries(selected.map(process => [process,processGuide[process]])),
      citation:{document:"selection-chart",page:1,title:"How to Choose a Welder"},
      visual:{type:"manual-page",document:"selection-chart",page:1,caption:"Visual welding-process selection chart"}
    });
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
    if (!found) return result({found:false});
    const imagePath = document === "owner-manual"
      ? `/manual/page-${page}.jpg`
      : document === "quick-start"
        ? `/quick-start/page-${page}.jpg`
        : "/reference/selection-chart.jpg";
    return result({found:true,...found,imagePath});
  }
);

const productServer = createSdkMcpServer({
  name:"product",
  version:"1.0.0",
  tools:[searchManualTool,dutyCycleTool,connectionTool,diagnosticTool,processGuideTool,pageTool]
});

const allowedTools = [
  "mcp__product__search_manual",
  "mcp__product__lookup_duty_cycle",
  "mcp__product__lookup_connections",
  "mcp__product__lookup_diagnostic",
  "mcp__product__compare_processes",
  "mcp__product__read_manual_page"
];

const systemPrompt = `You are Arcsmith, a garage-side technical copilot for the Vulcan OmniPro 220.

Accuracy rules:
1. Call at least one product tool before every technical answer. Never answer product facts from memory.
2. Use lookup_duty_cycle for every duty-cycle question. Never interpolate between rated points.
3. Ask for process, input voltage, amperage, material, thickness, consumable, or gas when any is necessary and missing.
4. Distinguish gas-shielded solid-wire MIG from self-shielded flux-core. Their polarity and porosity checks differ.
5. For Stick polarity, require the electrode classification. Do not guess.
6. Cite only pages returned by tools. Cite printed PDF page numbers exactly.
7. Prefer a useful visual artifact over a long explanation. Use a manual-page, exact duty-cycle control, connection map, diagnostic checklist, process guide, or clarification choices.
8. Do not output numeric settings that the supplied documents do not establish. Tell the user to use the OmniPro Auto Weld workflow when exact wire speed or voltage is absent.
9. Safety warnings must be direct. Never suggest servicing an energized machine.

Return only the structured response. Each artifact must use one of these exact forms:
- manual-page: document, page, caption
- duty-cycle: process, voltage, exact ratings array, selectedAmps
- connection: title, process, connections, warning
- checklist: title, items with check and action, safety
- process-guide: recommended, reasons, alternatives, source
- clarification: question, options

If clarification is needed, set needsClarification true, include a clarification artifact, and ask one precise follow-up. Otherwise set it false. followUp must always be a string, using an empty string if no follow-up is useful.`;

const sessions = new Map<string,string>();
const MAX_SESSIONS = 250;

function canonicalize(response: CoreAgentResponse): CoreAgentResponse {
  const citations = response.citations.filter(item => Boolean(getManualPage(item.document,item.page)));
  const artifacts = response.artifacts
    .filter(artifact => artifact.type !== "manual-page" || Boolean(getManualPage(artifact.document,artifact.page)))
    .map(artifact => {
      if (artifact.type === "duty-cycle") {
        const process = artifact.process === "Flux-core" ? "MIG" : artifact.process;
        const record = dutyRecords.find(item => item.process === process && item.voltage === artifact.voltage);
        if (!record) return artifact;
        return {
          ...artifact,
          ratings:record.ratings,
          selectedAmps:record.ratings.some(item => item.amps === artifact.selectedAmps)
            ? artifact.selectedAmps
            : record.ratings[0].amps
        };
      }
      if (artifact.type === "connection") {
        const verified = connections[artifact.process];
        return { ...artifact, connections:verified.connections, warning:verified.warning };
      }
      return artifact;
    });
  return { ...response, citations, artifacts };
}

async function executeAgent(message: string, resume?: string) {
  let output: CoreAgentResponse | undefined;
  let sessionId: string | undefined;
  let errors: string[] = [];
  for await (const event of query({
    prompt:message,
    options:{
      ...(resume ? {resume} : {}),
      model:process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
      systemPrompt,
      allowedTools,
      mcpServers:{product:productServer},
      permissionMode:"dontAsk",
      maxTurns:7,
      maxThinkingTokens:5000,
      maxBudgetUsd:0.18,
      outputFormat:{type:"json_schema",schema:responseJsonSchema}
    }
  })) {
    if (event.type === "result") {
      sessionId = event.session_id;
      if (event.subtype === "success" && event.structured_output) {
        const parsed = CoreAgentResponseSchema.safeParse(event.structured_output);
        if (parsed.success) output = canonicalize(parsed.data);
        else errors.push(parsed.error.message);
      } else if (event.subtype !== "success") {
        errors = event.errors;
      }
    }
  }
  if (!output || !sessionId) throw new Error(errors.join("; ") || "Claude returned no valid structured response");
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
