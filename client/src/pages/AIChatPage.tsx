import { FormEvent, Fragment, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import Button, { LoadingButton } from "@atlaskit/button";
import ReactMarkdown from "react-markdown";
import SectionMessage from "@atlaskit/section-message";
import Spinner from "@atlaskit/spinner";
import TextArea from "@atlaskit/textarea";
import { token } from "@atlaskit/tokens";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import Modal from "../components/Modal";
import {
  askChatQuestion,
  ChatHistoryMessage,
  ChatStatusResponse,
  getChatStatus,
  LlmDebugEntry,
} from "../api/chat";

type ChatRole = "assistant" | "user" | "warning";

type ChatMessage = {
  id: number;
  role: ChatRole;
  text: string;
  followUpQuestions?: string[];
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

const CHAT_SESSION_STORAGE_KEY = "tjenesteguide_ai_chat_session_v1";
const APP_TITLE = "Tjenesteguide";
const CHATBOT_NAME = "Ingunn";
const DEFAULT_ASSISTANT_MESSAGE: ChatMessage = {
  id: 1,
  role: "assistant",
  text:
    `Hei. Jeg heter ${CHATBOT_NAME}, og jeg hjelper deg gjerne med å finne fram i ${APP_TITLE}. ` +
    "Dette er en informasjonstjeneste for tjenester levert av Alta kommune og samarbeidspartnere. " +
    "Jeg hjelper deg gjerne med å finne fram i tilbud, kriterier, priser og hvordan du går videre.",
};

function getAssistantMessageLabel(message: ChatMessage): string {
  return message.id === DEFAULT_ASSISTANT_MESSAGE.id ? `${CHATBOT_NAME} sier` : `${CHATBOT_NAME} svarer`;
}

function loadMessagesFromSession(): ChatMessage[] {
  if (typeof window === "undefined") {
    return [DEFAULT_ASSISTANT_MESSAGE];
  }

  const raw = window.sessionStorage.getItem(CHAT_SESSION_STORAGE_KEY);
  if (!raw) {
    return [DEFAULT_ASSISTANT_MESSAGE];
  }

  try {
    const parsed = JSON.parse(raw) as ChatMessage[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [DEFAULT_ASSISTANT_MESSAGE];
    }

    const sanitized = parsed
      .filter(
        (message) =>
          message &&
          typeof message === "object" &&
          typeof message.id === "number" &&
          (message.role === "assistant" ||
            message.role === "user" ||
            message.role === "warning") &&
          typeof message.text === "string"
      )
      .slice(-60);

    return sanitized.length > 0 ? sanitized : [DEFAULT_ASSISTANT_MESSAGE];
  } catch {
    return [DEFAULT_ASSISTANT_MESSAGE];
  }
}

export default function AIChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessagesFromSession());
  const nextIdRef = useRef<number>(
    Math.max(0, ...messages.map((message) => message.id)) + 1
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugMode, setDebugMode] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusDialogOpen, setStatusDialogOpen] = useState(false);
  const [llmStatus, setLlmStatus] = useState<ChatStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const canSend = input.trim().length > 0 && !loading;

  const latestStats = useMemo(
    () => [...messages].reverse().find((message) => message.metadata)?.metadata,
    [messages]
  );
  const conversationDebugEntries = useMemo(
    () =>
      messages.flatMap((message) =>
        (message.debugTraces ?? []).map((trace, index) => ({
          messageId: message.id,
          role: message.role,
          label:
            message.role === "warning"
              ? "Personvernkontroll"
              : message.role === "assistant"
              ? getAssistantMessageLabel(message)
              : "Du",
          preview: message.text.slice(0, 180),
          traceIndex: index + 1,
          trace,
        }))
      ),
    [messages]
  );
  const latestAssistantFollowUpMessageId = useMemo(
    () =>
      [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "assistant" &&
            Array.isArray(message.followUpQuestions) &&
            message.followUpQuestions.length > 0
        )?.id ?? null,
    [messages]
  );

  useEffect(() => {
    window.sessionStorage.setItem(CHAT_SESSION_STORAGE_KEY, JSON.stringify(messages));
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    void refreshLlmStatus();
  }, []);

  function buildHistoryFromMessages(currentMessages: ChatMessage[]): ChatHistoryMessage[] {
    return currentMessages
      .flatMap((message) => {
        if (message.role !== "assistant" && message.role !== "user") {
          return [];
        }
        return [
          {
            role: message.role,
            text: message.text,
          } satisfies ChatHistoryMessage,
        ];
      })
      .slice(-20);
  }

  function appendMessage(
    role: ChatRole,
    text: string,
    followUpQuestions?: string[],
    metadata?: ChatMessage["metadata"],
    debugTraces?: LlmDebugEntry[]
  ) {
    const id = nextIdRef.current++;
    setMessages((prev) => [
      ...prev,
      { id, role, text, followUpQuestions, metadata, debugTraces },
    ]);
  }

  async function refreshLlmStatus() {
    setStatusLoading(true);
    try {
      const nextStatus = await getChatStatus();
      setLlmStatus(nextStatus);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      setLlmStatus({
        checkedAt: new Date().toISOString(),
        privacy: {
          ready: false,
          label: "Privat LLM utilgjengelig",
          details: detail,
        },
        public: {
          ready: false,
          label: "Offentlig LLM utilgjengelig",
          details: detail,
        },
      });
    } finally {
      setStatusLoading(false);
    }
  }

  async function sendQuestion(rawQuestion: string) {
    const question = rawQuestion.trim();
    if (!question || loading) {
      return;
    }
    const history = buildHistoryFromMessages(messages);

    setError(null);
    appendMessage("user", question);
    setInput("");
    setLoading(true);

    try {
      const response = await askChatQuestion(question, {
        debug: debugMode,
        history,
      });

      if (response.blocked) {
        const warningText = response.details
          ? `${response.warning}\n\nDetaljer: ${response.details}`
          : response.warning;
        appendMessage(
          "warning",
          warningText ||
            "Meldingen din kan inneholde sensitiv informasjon. Fjern persondata og prøv igjen.",
          undefined,
          undefined,
          response.debug?.traces
        );
      } else {
        appendMessage(
          "assistant",
          response.answer,
          response.followUpQuestions,
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

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendQuestion(input);
    }
  }

  function resetConversation() {
    setMessages([DEFAULT_ASSISTANT_MESSAGE]);
    nextIdRef.current = DEFAULT_ASSISTANT_MESSAGE.id + 1;
    setInput("");
    setError(null);
    window.sessionStorage.setItem(
      CHAT_SESSION_STORAGE_KEY,
      JSON.stringify([DEFAULT_ASSISTANT_MESSAGE])
    );
  }

  const showWelcomePanel = messages.length <= 1;
  const visibleMessages = messages;
  const relevanceLabel = latestStats
    ? `${latestStats.inkludert_i_prompt} relevante tjenester vurdert i siste svar`
    : "Klar til å hjelpe med spørsmål om kommunale tjenester";
  const checkedAtText = llmStatus?.checkedAt
    ? new Date(llmStatus.checkedAt).toLocaleTimeString("nb-NO", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  const privateReady = llmStatus?.privacy.ready === true;
  const publicReady = llmStatus?.public.ready === true;
  const allReady = privateReady && publicReady;
  const overallStatusAriaLabel = statusLoading
    ? "Status: sjekker systemstatus"
    : allReady
    ? "Status: klar"
    : "Status: krever oppmerksomhet";

  return (
    <div className="ads-chat-page">
      {error && (
        <SectionMessage appearance="error" title="Kunne ikke behandle forespørselen">
          <p>{error}</p>
        </SectionMessage>
      )}

      <section className="ads-chat-shell">
        <header className="ads-chat-header">
          <div className="ads-chat-header-topbar">
            <div className="ads-chat-header-spacer" aria-hidden="true" />

            <div className="ads-chat-header-actions">
              <button
                type="button"
                className={`ads-chat-status-chip ${
                  statusLoading
                    ? "ads-chat-status-chip-pending"
                    : allReady
                    ? "ads-chat-status-chip-ready"
                    : "ads-chat-status-chip-error"
                }`}
                onClick={() => setStatusDialogOpen(true)}
                aria-label={overallStatusAriaLabel}
                title="Vis systemstatus"
              >
                <span className="ads-chat-status-chip-dot" aria-hidden="true" />
                <span>Status</span>
              </button>

              <button
                type="button"
                className="ads-chat-new-chat-button"
                onClick={resetConversation}
                aria-label="Start ny chat"
                title="Ny chat"
              >
                <PlusIcon />
                <span>Ny chat</span>
              </button>

              <button
                type="button"
                className="ads-chat-settings-button"
                onClick={() => setSettingsOpen((current) => !current)}
                aria-expanded={settingsOpen}
                aria-label="Åpne innstillinger"
                title="Innstillinger"
              >
                <CogIcon />
              </button>
            </div>
          </div>

          <div className="ads-chat-header-copy">
            <h1 className="ads-chat-title">{APP_TITLE}</h1>
            <p className="ads-chat-subtitle">
              Informasjonstjeneste for tjenester levert av Alta kommune og samarbeidspartnere
            </p>
          </div>
        </header>

        <div className="ads-chat-main">
          <div className="ads-chat-thread">
            {visibleMessages.map((message) => (
              <Fragment key={message.id}>
                <MessageBubble message={message} />
                {message.id === latestAssistantFollowUpMessageId &&
                  message.role === "assistant" &&
                  Array.isArray(message.followUpQuestions) &&
                  message.followUpQuestions.length > 0 &&
                  !loading && (
                    <FollowUpQuestionRow
                      questions={message.followUpQuestions}
                      onSelectQuestion={(question) => void sendQuestion(question)}
                      disabled={loading}
                    />
                  )}
              </Fragment>
            ))}

            {showWelcomePanel && (
              <div className="ads-chat-welcome">
                <p className="ads-chat-welcome-caption">Prøv et av disse spørsmålene</p>
                <div className="ads-chat-prompt-grid">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="ads-chat-prompt-card"
                      onClick={() => void sendQuestion(prompt)}
                      disabled={loading}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {loading && (
              <div className="ads-chat-message ads-chat-message-assistant">
                <div
                  className="ads-chat-avatar ads-chat-avatar-assistant ads-chat-avatar-typing"
                  aria-hidden="true"
                >
                  <BotIcon />
                </div>
                <div className="ads-chat-message-content">
                  <div className="ads-chat-message-label">{`${CHATBOT_NAME} svarer`}</div>
                  <div className="ads-chat-bubble ads-chat-bubble-assistant">
                    <div className="ads-chat-loading">
                      <Spinner size="small" />
                      <span>Skriver svar...</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="ads-chat-bottom">
            <form onSubmit={handleSubmit} className="ads-chat-composer">
              <div className="ads-chat-lane ads-chat-composer-lane">
                <div className="ads-chat-composer-box">
                  <TextArea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={handleComposerKeyDown}
                    placeholder="Skriv spørsmålet ditt her. Ikke oppgi navn, adresser, personnummer eller andre identifiserende detaljer."
                    minimumRows={2}
                    resize="smart"
                    isDisabled={loading}
                    appearance="none"
                  />
                  <LoadingButton
                    type="submit"
                    appearance="primary"
                    className="ads-chat-send-button"
                    isDisabled={!canSend}
                    isLoading={loading}
                    aria-label="Send melding"
                    title="Send melding"
                  >
                    <SendIcon />
                  </LoadingButton>
                </div>
              </div>
            </form>
            <p className="ads-chat-disclaimer ads-chat-lane">
              Svarene er laget av kunstig intelligens og kan inneholde feil eller mangler. Ikke del
              personopplysninger, og kontroller viktig informasjon med Alta kommune eller aktuell
              tjeneste.
            </p>
          </div>
        </div>
      </section>

      <Modal
        isOpen={statusDialogOpen}
        onClose={() => setStatusDialogOpen(false)}
        title="Systemstatus"
        variant="chat"
      >
        <div className="ads-chat-modal-layout">
          <section className="ads-chat-modal-section">
            <div className="ads-chat-modal-section-head">
              <div>
                <p className="ads-chat-modal-kicker">Systemstatus</p>
                <h3 className="ads-chat-modal-title">Modelltilgjengelighet</h3>
              </div>
              <Button appearance="subtle" spacing="compact" onClick={() => void refreshLlmStatus()}>
                Oppdater
              </Button>
            </div>

            <div className="ads-chat-modal-status-grid">
              <div className="ads-chat-modal-status-card">
                <StatusRow
                  title="Privat LLM"
                  label={llmStatus?.privacy.label || "Sjekker forbindelse"}
                  ready={privateReady}
                  pending={statusLoading}
                />
                {llmStatus?.privacy.details && (
                  <p className="ads-chat-modal-status-detail">{llmStatus.privacy.details}</p>
                )}
              </div>
              <div className="ads-chat-modal-status-card">
                <StatusRow
                  title="Offentlig LLM"
                  label={llmStatus?.public.label || "Sjekker forbindelse"}
                  ready={publicReady}
                  pending={statusLoading}
                />
                {llmStatus?.public.details && (
                  <p className="ads-chat-modal-status-detail">{llmStatus.public.details}</p>
                )}
              </div>
            </div>

            <p className="ads-chat-modal-footnote">
              {checkedAtText ? `Sist sjekket ${checkedAtText}` : "Status blir sjekket automatisk når siden åpnes."}
            </p>
          </section>
        </div>
      </Modal>

      <Modal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        title="Chatinnstillinger"
        variant="chat"
      >
        <div className="ads-chat-modal-layout">
          <section className="ads-chat-modal-section">
            <p className="ads-chat-modal-kicker">Samtale</p>
            <div className="ads-chat-modal-action-list">
              <div className="ads-chat-modal-action-row">
                <div>
                  <strong>Debug-data</strong>
                  <span>Samle LLM-kommunikasjon i ett felles debugpanel.</span>
                </div>
                <Button
                  appearance={debugMode ? "primary" : "subtle"}
                  spacing="compact"
                  onClick={() => setDebugMode((current) => !current)}
                >
                  {debugMode ? "På" : "Av"}
                </Button>
              </div>
              <div className="ads-chat-modal-action-row">
                <div>
                  <strong>Nullstill økt</strong>
                  <span>Fjern gjeldende samtalehistorikk i nettleseren.</span>
                </div>
                <Button appearance="subtle" spacing="compact" onClick={resetConversation}>
                  Nullstill
                </Button>
              </div>
            </div>
          </section>

          <section className="ads-chat-modal-section">
            <div className="ads-chat-modal-section-head">
              <div>
                <p className="ads-chat-modal-kicker">Debug</p>
                <h3 className="ads-chat-modal-title">Samtalelogger</h3>
              </div>
            </div>

            {!debugMode ? (
              <p className="ads-chat-modal-footnote">
                Slå på debug-data for å samle teknisk LLM-kommunikasjon her.
              </p>
            ) : conversationDebugEntries.length === 0 ? (
              <p className="ads-chat-modal-footnote">
                Ingen debug-data er samlet ennå i denne samtalen.
              </p>
            ) : (
              <details className="ads-chat-modal-debug" open>
                <summary>
                  Vis debug-data for hele samtalen ({conversationDebugEntries.length})
                </summary>
                <pre>
                  {JSON.stringify(conversationDebugEntries, null, 2)}
                </pre>
              </details>
            )}
          </section>

          <section className="ads-chat-modal-section">
            <p className="ads-chat-modal-kicker">Aktiv kontekst</p>
            <p className="ads-chat-modal-footnote">{relevanceLabel}</p>
          </section>
        </div>
      </Modal>
    </div>
  );
}

function MessageBubble({
  message,
}: {
  message: ChatMessage;
}) {
  const isUser = message.role === "user";
  const isWarning = message.role === "warning";
  const messageLabel = isUser
    ? null
    : isWarning
    ? "Personvernkontroll"
    : getAssistantMessageLabel(message);

  return (
    <div
      className={`ads-chat-message ${
        isUser ? "ads-chat-message-user" : "ads-chat-message-assistant"
      }`}
    >
      {!isUser && (
        <div
          className={`ads-chat-avatar ${
            isWarning ? "ads-chat-avatar-warning" : "ads-chat-avatar-assistant"
          }`}
          aria-hidden="true"
        >
          {isWarning ? <WarningIcon /> : <BotIcon />}
        </div>
      )}

      <div className="ads-chat-message-content">
        {messageLabel && <div className="ads-chat-message-label">{messageLabel}</div>}
        <div
          className={`ads-chat-bubble ${
            isUser
              ? "ads-chat-bubble-user"
              : isWarning
              ? "ads-chat-bubble-warning"
              : "ads-chat-bubble-assistant"
          }`}
        >
          {isUser ? (
            <div className="ads-chat-plain-text">{message.text}</div>
          ) : (
            <MarkdownMessage content={message.text} />
          )}
        </div>
      </div>

      {isUser && (
        <div className="ads-chat-avatar ads-chat-avatar-user" aria-hidden="true">
          <UserIcon />
        </div>
      )}
    </div>
  );
}

function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="ads-chat-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          a: ({ ...props }) => <a {...props} target="_blank" rel="noreferrer" />,
          table: ({ children }) => (
            <div className="ads-chat-table-wrap">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function FollowUpQuestionRow({
  questions,
  onSelectQuestion,
  disabled,
}: {
  questions: string[];
  onSelectQuestion: (question: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="ads-chat-followups">
      <div className="ads-chat-followups-spacer" aria-hidden="true" />
      <div className="ads-chat-followups-content">
        <p className="ads-chat-quick-heading">Forslag til neste spørsmål</p>
        <div className="ads-chat-quick-lane">
          {questions.map((question) => (
            <button
              key={question}
              type="button"
              className="ads-chat-quick-pill"
              onClick={() => onSelectQuestion(question)}
              disabled={disabled}
            >
              {question}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatusRow({
  title,
  label,
  ready,
  pending,
}: {
  title: string;
  label: string;
  ready: boolean;
  pending?: boolean;
}) {
  return (
    <div className="ads-chat-status-row">
      <span
        className={`ads-chat-status-row-dot ${
          pending
            ? "ads-chat-status-row-dot-pending"
            : ready
            ? "ads-chat-status-row-dot-ready"
            : "ads-chat-status-row-dot-error"
        }`}
        aria-hidden="true"
      />
      <div className="ads-chat-status-row-copy">
        <strong>{title}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

function BotIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ width: 32, height: 32 }}
    >
      <circle cx="8.2" cy="8.8" r="1.55" fill="currentColor" />
      <circle cx="15.8" cy="8.8" r="1.55" fill="currentColor" />
      <path
        d="M6.7 13.3c1.55 2.1 3.33 3.15 5.3 3.15s3.75-1.05 5.3-3.15"
        stroke="currentColor"
        strokeWidth="2.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ width: 26, height: 26 }}
    >
      <circle cx="12" cy="8.5" r="3.4" stroke="currentColor" strokeWidth="1.9" />
      <path
        d="M5.5 18.25c1.7-2.85 4.12-4.25 6.5-4.25 2.38 0 4.8 1.4 6.5 4.25"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ width: 26, height: 26 }}
    >
      <path
        d="M12 3.75 20 7.5v5.62c0 4.06-2.95 6.95-8 7.88-5.05-.93-8-3.82-8-7.88V7.5l8-3.75Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 8.2v4.55"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16.2" r="1.05" fill="currentColor" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ width: 18, height: 18 }}
    >
      <path
        d="M4.75 12h13.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.75 5.5 19.25 12l-6.5 6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CogIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ width: 18, height: 18, color: token("color.icon", "#44546F") }}
    >
      <path
        d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM19.4 12a7.52 7.52 0 0 0-.1-1.2l2-1.56-2-3.46-2.43.67a7.91 7.91 0 0 0-2.06-1.2L14.4 2h-4.8l-.4 3.25a7.91 7.91 0 0 0-2.06 1.2l-2.43-.67-2 3.46 2 1.56A7.52 7.52 0 0 0 4.6 12c0 .41.03.81.1 1.2l-2 1.56 2 3.46 2.43-.67c.63.5 1.32.9 2.06 1.2L9.6 22h4.8l.4-3.25c.74-.3 1.43-.7 2.06-1.2l2.43.67 2-3.46-2-1.56c.07-.39.1-.79.1-1.2Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      style={{ width: 16, height: 16 }}
    >
      <path
        d="M12 5.25v13.5M5.25 12h13.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
