import { FormEvent, useMemo, useRef, useState } from "react";
import { askChatQuestion, LlmDebugEntry } from "../api/chat";

type ChatRole = "assistant" | "user" | "warning";

type ChatMessage = {
  id: number;
  role: ChatRole;
  text: string;
  metadata?: {
    total_tjenester: number;
    inkludert_i_prompt: number;
    katalog_i_prompt?: number;
  };
  debugTraces?: LlmDebugEntry[];
};

const QUICK_PROMPTS = [
  "Hva er forskjellen på vedtaksbaserte tjenester og lavterskeltilbud?",
  "Hvilke tjenester nevner BPA i beskrivelsen?",
  "Hvilke tjenester har informasjon om pris?",
  "Hvilke tjenester er mest relevante for barn og unge?",
];

export default function AIChatPage() {
  const nextIdRef = useRef(2);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      role: "assistant",
      text:
        "Hei. Jeg svarer kun basert på innholdet i tjenester.json. " +
        "Hvis informasjonen ikke finnes der, sier jeg ifra.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);

  const canSend = input.trim().length > 0 && !loading;

  const latestStats = useMemo(
    () => [...messages].reverse().find((message) => message.metadata)?.metadata,
    [messages]
  );

  function appendMessage(
    role: ChatRole,
    text: string,
    metadata?: ChatMessage["metadata"],
    debugTraces?: LlmDebugEntry[]
  ) {
    const id = nextIdRef.current++;
    setMessages((prev) => [...prev, { id, role, text, metadata, debugTraces }]);
  }

  async function sendQuestion(rawQuestion: string) {
    const question = rawQuestion.trim();
    if (!question || loading) {
      return;
    }

    setError(null);
    appendMessage("user", question);
    setInput("");
    setLoading(true);

    try {
      const response = await askChatQuestion(question, { debug: debugMode });

      if (response.blocked) {
        const warningText = response.details
          ? `${response.warning}\n\nDetaljer: ${response.details}`
          : response.warning;
        appendMessage(
          "warning",
          warningText ||
            "Meldingen din kan inneholde sensitiv informasjon. Fjern persondata og prøv igjen.",
          undefined,
          response.debug?.traces
        );
      } else {
        appendMessage(
          "assistant",
          response.answer,
          response.metadata,
          response.debug?.traces
        );
      }
    } catch (err: any) {
      setError(err?.message || "Kunne ikke få svar fra chatten");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void sendQuestion(input);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-[var(--color-text)]">AI-chat</h1>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">
            Svarer kun fra innholdet i `tjenester.json`.
          </p>
        </div>
        {latestStats && (
          <div className="badge badge-muted">
            Kontekst: {latestStats.inkludert_i_prompt}/{latestStats.total_tjenester} tjenester
          </div>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          id="chat-debug-mode"
          type="checkbox"
          checked={debugMode}
          onChange={(event) => setDebugMode(event.target.checked)}
          className="h-4 w-4 rounded border-[var(--color-border)] text-[var(--color-primary)] focus:ring-[var(--color-primary)]"
        />
        <label
          htmlFor="chat-debug-mode"
          className="text-sm font-medium text-[var(--color-text-muted)]"
        >
          Debug mode: vis all LLM-kommunikasjon
        </label>
      </div>

      <div className="surface-muted p-4 sm:p-5">
        <p className="text-sm text-[var(--color-text-muted)]">
          Før svaret sendes til offentlig LLM, kjøres meldingen din gjennom lokal
          personvernkontroll. Hvis meldingen ser sensitiv ut, får du beskjed om å endre den.
        </p>
      </div>

      {error && (
        <div className="card p-4 border-l-4 border-red-500 bg-red-50/90">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="border-b border-[var(--color-border)] bg-white px-4 py-3">
          <p className="text-sm font-semibold text-[var(--color-text)]">Samtale</p>
        </div>
        <div className="max-h-[56vh] overflow-y-auto bg-[var(--color-bg-alt)]/40 p-4 space-y-3">
          {messages.map((message) => {
            const isUser = message.role === "user";
            const isWarning = message.role === "warning";
            return (
              <div
                key={message.id}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] rounded-xl px-4 py-3 text-sm leading-6 shadow-sm whitespace-pre-wrap ${
                    isUser
                      ? "bg-[var(--color-primary)] text-white"
                      : isWarning
                      ? "bg-amber-100 text-amber-900 border border-amber-200"
                      : "bg-white text-[var(--color-text)] border border-[var(--color-border)]"
                  }`}
                >
                  {message.text}
                  {message.debugTraces && message.debugTraces.length > 0 && (
                    <details className="mt-3 rounded-lg border border-[var(--color-border)] bg-white/80 p-2">
                      <summary className="cursor-pointer text-xs font-semibold text-[var(--color-text-muted)]">
                        Debug traces ({message.debugTraces.length})
                      </summary>
                      <pre className="mt-2 whitespace-pre-wrap break-all text-[11px] leading-5 text-[var(--color-text)] max-h-80 overflow-auto">
                        {JSON.stringify(message.debugTraces, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              </div>
            );
          })}
          {loading && (
            <div className="flex justify-start">
              <div className="rounded-xl px-4 py-3 text-sm bg-white border border-[var(--color-border)] text-[var(--color-text-muted)]">
                Tenker...
              </div>
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="border-t border-[var(--color-border)] bg-white p-4 space-y-3">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Skriv spørsmålet ditt her..."
            rows={4}
            className="input-field resize-y min-h-[7rem]"
            disabled={loading}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              {QUICK_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => void sendQuestion(prompt)}
                  className="px-3 py-1.5 rounded-full text-xs font-semibold border border-[var(--color-border)] text-[var(--color-text-muted)] bg-white hover:border-[var(--color-primary)]/40 hover:text-[var(--color-text)] transition-colors"
                  disabled={loading}
                >
                  {prompt}
                </button>
              ))}
            </div>
            <button type="submit" className="btn-primary" disabled={!canSend}>
              {loading ? "Sender..." : "Send"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
