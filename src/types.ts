export type DocumentId = "owner-manual" | "quick-start" | "selection-chart";
export type WeldingProcess = "MIG" | "Flux-core" | "TIG" | "Stick";

export type Citation = {
  document: DocumentId;
  page: number;
  title: string;
};

export type DutyRating = {
  amps: number;
  percent: number;
  weldMinutes: number;
  restMinutes: number;
};

export type Artifact =
  | {
      type: "manual-page";
      document: DocumentId;
      page: number;
      caption: string;
    }
  | {
      type: "duty-cycle";
      process: WeldingProcess;
      voltage: 120 | 240;
      ratings: DutyRating[];
      selectedAmps: number;
    }
  | {
      type: "connection";
      title: string;
      process: WeldingProcess;
      connections: Array<{
        label: string;
        terminal: "positive" | "negative" | "gas" | "workpiece" | "screen";
        note: string;
      }>;
      warning: string;
    }
  | {
      type: "checklist";
      title: string;
      items: Array<{ check: string; action: string }>;
      safety: string;
    }
  | {
      type: "process-guide";
      recommended: WeldingProcess;
      reasons: string[];
      alternatives: string[];
      source: string;
    }
  | {
      type: "settings-configurator";
      process: WeldingProcess | null;
      voltage: 120 | 240 | null;
      material: string;
      thickness: string;
      consumable: string;
      gas: string;
      requiredInputs: string[];
      machineOutputs: string[];
      sourcePage: number;
      warning: string;
    }
  | {
      type: "clarification";
      question: string;
      options: string[];
    };

export type CoreAgentResponse = {
  answer: string;
  citations: Citation[];
  artifacts: Artifact[];
  needsClarification: boolean;
  followUp: string;
};

export type AgentResponse = CoreAgentResponse & {
  mode: "agent" | "offline";
  conversationId: string;
};

export type ChatMessage =
  | {
      role: "user";
      content: string;
      imageUrl?: string;
      imageName?: string;
    }
  | {
      role: "assistant";
      content: string;
      citations?: Citation[];
      artifacts?: Artifact[];
      followUp?: string;
      mode?: "agent" | "offline";
    };
