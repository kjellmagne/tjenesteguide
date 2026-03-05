const CHAT_API_BASE = "/api/chat";

export type AskChatResponse =
  | {
      blocked: true;
      warning: string;
      details?: string;
    }
  | {
      blocked: false;
      answer: string;
      metadata?: {
        total_tjenester: number;
        inkludert_i_prompt: number;
      };
    };

export async function askChatQuestion(message: string): Promise<AskChatResponse> {
  const response = await fetch(`${CHAT_API_BASE}/ask`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
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
