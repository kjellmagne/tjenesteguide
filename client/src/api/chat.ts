const CHAT_API_BASE = "/api/chat";

export type LlmDebugEntry = {
  step: "privacy" | "gemini";
  provider: string;
  model: string;
  url: string;
  requestBody: unknown;
  responseStatus?: number;
  responseBody?: unknown;
  startedAt: string;
  durationMs: number;
  error?: string;
};

export type ChatHistoryMessage = {
  role: "user" | "assistant";
  text: string;
};

export type AskChatResponse =
  | {
      blocked: true;
      warning: string;
      details?: string;
      debug?: {
        traces: LlmDebugEntry[];
      };
    }
  | {
      blocked: false;
      answer: string;
      followUpQuestions?: string[];
      metadata?: {
        total_tjenester: number;
        inkludert_i_prompt: number;
        katalog_i_prompt?: number;
      };
      debug?: {
        traces: LlmDebugEntry[];
      };
    };

export type ChatStatusResponse = {
  checkedAt: string;
  privacy: {
    ready: boolean;
    label: string;
    details?: string;
  };
  public: {
    ready: boolean;
    label: string;
    details?: string;
  };
};

export async function askChatQuestion(
  message: string,
  options?: { debug?: boolean; history?: ChatHistoryMessage[] }
): Promise<AskChatResponse> {
  const response = await fetch(`${CHAT_API_BASE}/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message,
      debug: options?.debug === true,
      history: options?.history || [],
    }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const baseError =
      (payload && typeof payload.error === "string" && payload.error) ||
      "Ukjent feil ved chat-kall";
    const detail =
      payload && typeof payload.details === "string" ? payload.details : "";
    throw new Error(detail ? `${baseError}: ${detail}` : baseError);
  }

  return payload as AskChatResponse;
}

export async function getChatStatus(): Promise<ChatStatusResponse> {
  const response = await fetch(`${CHAT_API_BASE}/status`);
  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload) {
    throw new Error("Kunne ikke hente chat-status");
  }

  return payload as ChatStatusResponse;
}
