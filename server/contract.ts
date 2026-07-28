import { z } from "zod";

const documentId = z.enum(["owner-manual", "quick-start", "selection-chart"]);
const process = z.enum(["MIG", "Flux-core", "TIG", "Stick"]);
const terminal = z.enum(["positive", "negative", "gas", "workpiece", "screen"]);

export const CitationSchema = z.object({
  document: documentId,
  page: z.number().int().positive(),
  title: z.string().min(1).max(120)
}).strict();

const ManualPageArtifactSchema = z.object({
  type: z.literal("manual-page"),
  document: documentId,
  page: z.number().int().positive(),
  caption: z.string().min(1).max(180)
}).strict();

const DutyArtifactSchema = z.object({
  type: z.literal("duty-cycle"),
  process,
  voltage: z.union([z.literal(120), z.literal(240)]),
  ratings: z.array(z.object({
    amps: z.number().positive(),
    percent: z.number().min(1).max(100),
    weldMinutes: z.number().min(0).max(10),
    restMinutes: z.number().min(0).max(10)
  }).strict()).min(1).max(4),
  selectedAmps: z.number().positive()
}).strict();

const ConnectionArtifactSchema = z.object({
  type: z.literal("connection"),
  title: z.string().min(1).max(160),
  process,
  connections: z.array(z.object({
    label: z.string().min(1).max(100),
    terminal,
    note: z.string().min(1).max(220)
  }).strict()).min(1).max(8),
  warning: z.string().min(1).max(300)
}).strict();

const ChecklistArtifactSchema = z.object({
  type: z.literal("checklist"),
  title: z.string().min(1).max(160),
  items: z.array(z.object({
    check: z.string().min(1).max(140),
    action: z.string().min(1).max(300)
  }).strict()).min(1).max(10),
  safety: z.string().min(1).max(320)
}).strict();

const ProcessGuideArtifactSchema = z.object({
  type: z.literal("process-guide"),
  recommended: process,
  reasons: z.array(z.string().min(1).max(180)).min(1).max(6),
  alternatives: z.array(z.string().min(1).max(180)).max(6),
  source: z.string().min(1).max(180)
}).strict();

const SettingsConfiguratorArtifactSchema = z.object({
  type: z.literal("settings-configurator"),
  process: process.nullable(),
  voltage: z.union([z.literal(120), z.literal(240)]).nullable(),
  material: z.string().max(100),
  thickness: z.string().max(60),
  consumable: z.string().max(120),
  gas: z.string().max(120),
  requiredInputs: z.array(z.string().min(1).max(100)).min(1).max(8),
  machineOutputs: z.array(z.string().min(1).max(140)).min(1).max(6),
  sourcePage: z.number().int().positive(),
  warning: z.string().min(1).max(320)
}).strict();

const ClarificationArtifactSchema = z.object({
  type: z.literal("clarification"),
  question: z.string().min(1).max(220),
  options: z.array(z.string().min(1).max(100)).min(2).max(6)
}).strict();

export const ArtifactSchema = z.discriminatedUnion("type", [
  ManualPageArtifactSchema,
  DutyArtifactSchema,
  ConnectionArtifactSchema,
  ChecklistArtifactSchema,
  ProcessGuideArtifactSchema,
  SettingsConfiguratorArtifactSchema,
  ClarificationArtifactSchema
]);

export const CoreAgentResponseSchema = z.object({
  answer: z.string().min(1).max(4000),
  citations: z.array(CitationSchema).max(8),
  artifacts: z.array(ArtifactSchema).max(6),
  needsClarification: z.boolean(),
  followUp: z.string().max(300)
}).strict();

export const responseJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    answer: { type:"string" },
    citations: {
      type:"array",
      maxItems:8,
      items:{
        type:"object",
        additionalProperties:false,
        properties:{
          document:{ enum:["owner-manual","quick-start","selection-chart"] },
          page:{ type:"integer", minimum:1 },
          title:{ type:"string" }
        },
        required:["document","page","title"]
      }
    },
    artifacts: {
      type:"array",
      maxItems:6,
      items:{
        anyOf:[
          {
            type:"object", additionalProperties:false,
            properties:{ type:{const:"manual-page"}, document:{enum:["owner-manual","quick-start","selection-chart"]}, page:{type:"integer",minimum:1}, caption:{type:"string"} },
            required:["type","document","page","caption"]
          },
          {
            type:"object", additionalProperties:false,
            properties:{
              type:{const:"duty-cycle"}, process:{enum:["MIG","Flux-core","TIG","Stick"]}, voltage:{enum:[120,240]},
              ratings:{type:"array",items:{type:"object",additionalProperties:false,properties:{amps:{type:"number"},percent:{type:"number"},weldMinutes:{type:"number"},restMinutes:{type:"number"}},required:["amps","percent","weldMinutes","restMinutes"]}},
              selectedAmps:{type:"number"}
            },
            required:["type","process","voltage","ratings","selectedAmps"]
          },
          {
            type:"object", additionalProperties:false,
            properties:{
              type:{const:"connection"}, title:{type:"string"}, process:{enum:["MIG","Flux-core","TIG","Stick"]},
              connections:{type:"array",items:{type:"object",additionalProperties:false,properties:{label:{type:"string"},terminal:{enum:["positive","negative","gas","workpiece","screen"]},note:{type:"string"}},required:["label","terminal","note"]}},
              warning:{type:"string"}
            },
            required:["type","title","process","connections","warning"]
          },
          {
            type:"object", additionalProperties:false,
            properties:{
              type:{const:"checklist"}, title:{type:"string"},
              items:{type:"array",items:{type:"object",additionalProperties:false,properties:{check:{type:"string"},action:{type:"string"}},required:["check","action"]}},
              safety:{type:"string"}
            },
            required:["type","title","items","safety"]
          },
          {
            type:"object", additionalProperties:false,
            properties:{type:{const:"process-guide"},recommended:{enum:["MIG","Flux-core","TIG","Stick"]},reasons:{type:"array",items:{type:"string"}},alternatives:{type:"array",items:{type:"string"}},source:{type:"string"}},
            required:["type","recommended","reasons","alternatives","source"]
          },
          {
            type:"object", additionalProperties:false,
            properties:{
              type:{const:"settings-configurator"},
              process:{anyOf:[{enum:["MIG","Flux-core","TIG","Stick"]},{type:"null"}]},
              voltage:{anyOf:[{enum:[120,240]},{type:"null"}]},
              material:{type:"string"},
              thickness:{type:"string"},
              consumable:{type:"string"},
              gas:{type:"string"},
              requiredInputs:{type:"array",items:{type:"string"},minItems:1,maxItems:8},
              machineOutputs:{type:"array",items:{type:"string"},minItems:1,maxItems:6},
              sourcePage:{type:"integer",minimum:1},
              warning:{type:"string"}
            },
            required:["type","process","voltage","material","thickness","consumable","gas","requiredInputs","machineOutputs","sourcePage","warning"]
          },
          {
            type:"object", additionalProperties:false,
            properties:{type:{const:"clarification"},question:{type:"string"},options:{type:"array",items:{type:"string"},minItems:2,maxItems:6}},
            required:["type","question","options"]
          }
        ]
      }
    },
    needsClarification:{type:"boolean"},
    followUp:{type:"string"}
  },
  required:["answer","citations","artifacts","needsClarification","followUp"]
} as const;
