import express, { Request, Response } from "express";
import { getAllTjenester } from "../repository/tjenesterRepo";
import { Tjeneste } from "../models/tjeneste";

const router = express.Router();

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-pro";
const PRIVACY_LLM_PROVIDER = (process.env.PRIVACY_LLM_PROVIDER || "openai").toLowerCase();
const PRIVACY_MODEL =
  process.env.PRIVACY_MODEL ||
  process.env.LOCAL_GUARDRAIL_MODEL ||
  "google/gemma-3-27b-it";
const PRIVACY_ENDPOINT =
  process.env.PRIVACY_ENDPOINT ||
  process.env.LOCAL_GUARDRAIL_URL ||
  "http://10.200.16.103:8000/v1";
const PRIVACY_API_KEY = process.env.PRIVACY_API_KEY || process.env.OPENAI_API_KEY;
const PRIVACY_REQUIRED =
  (process.env.PRIVACY_REQUIRED ?? process.env.LOCAL_GUARDRAIL_REQUIRED ?? "true") !== "false";
const PRIVACY_TIMEOUT_MS = Number.parseInt(
  process.env.PRIVACY_TIMEOUT_MS || process.env.LOCAL_GUARDRAIL_TIMEOUT_MS || "7000",
  10
);
const MAX_QUESTION_LENGTH = 1600;
const MAX_DETAILED_CONTEXT_SERVICES = Number.parseInt(
  process.env.MAX_DETAILED_CONTEXT_SERVICES || "6",
  10
);
const MAX_TEXT_FIELD_CHARS = Number.parseInt(process.env.MAX_TEXT_FIELD_CHARS || "1200", 10);
const GEMINI_THINKING_BUDGET = Number.parseInt(
  process.env.GEMINI_THINKING_BUDGET || "256",
  10
);

type GuardrailDecision = {
  allow: boolean;
  reason: string;
};

type GeminiResponsePart = {
  text?: string;
};

type GeminiCandidate = {
  finishReason?: string;
  safetyRatings?: Array<{
    category?: string;
    probability?: string;
    blocked?: boolean;
  }>;
  content?: {
    parts?: GeminiResponsePart[];
  };
};

type GeminiGenerateContentResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: {
    blockReason?: string;
    blockReasonMessage?: string;
    safetyRatings?: Array<{
      category?: string;
      probability?: string;
      blocked?: boolean;
    }>;
  };
};

type LlmDebugEntry = {
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

type DebugCollector = {
  enabled: boolean;
  traces: LlmDebugEntry[];
  add: (entry: LlmDebugEntry) => void;
};

function createDebugCollector(enabled: boolean): DebugCollector {
  const traces: LlmDebugEntry[] = [];
  return {
    enabled,
    traces,
    add: (entry) => {
      if (enabled) {
        traces.push(entry);
      }
    },
  };
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function resolveTextField(plainText?: string, legacyArray?: string[]): string {
  const value = plainText || (legacyArray || []).join("\n\n");
  return value.trim();
}

function clipText(value: string, maxChars: number = MAX_TEXT_FIELD_CHARS): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxChars) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxChars)} ...`;
}

function normalizeForSearch(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9æøå]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSearchTerms(question: string): string[] {
  const stopWords = new Set([
    "hva",
    "hvordan",
    "hvilke",
    "hvilken",
    "hvem",
    "kan",
    "skal",
    "som",
    "for",
    "med",
    "til",
    "og",
    "eller",
    "om",
    "på",
    "i",
    "er",
    "det",
    "en",
    "et",
    "de",
    "jeg",
    "vi",
    "du",
    "the",
    "and",
    "with",
  ]);

  return normalizeForSearch(question)
    .split(" ")
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !stopWords.has(term));
}

function buildServiceSearchText(tjeneste: Tjeneste): string {
  return normalizeForSearch(
    [
      tjeneste.navn,
      tjeneste.kort_navn,
      ...(tjeneste.synonymer || []),
      ...(tjeneste.kategori_sti || []),
      ...(tjeneste.temaer || []),
      tjeneste.tjenestetype,
      ...(tjeneste.målgruppe || []).flatMap((målgruppe) => [
        målgruppe.beskrivelse,
        ...(målgruppe.kategorier || []),
      ]),
      resolveTextField(tjeneste.for_du_søker_plain_text, tjeneste.for_du_søker),
      tjeneste.beskrivelse_plain_text || tjeneste.beskrivelse,
      resolveTextField(
        tjeneste.tildelingskriterier_plain_text,
        tjeneste.tildelingskriterier
      ),
      resolveTextField(
        tjeneste.dette_inngår_ikke_i_tjenestetilbudet_plain_text,
        tjeneste.dette_inngår_ikke_i_tjenestetilbudet
      ),
      resolveTextField(tjeneste.hva_kan_du_forvente_plain_text, tjeneste.hva_kan_du_forvente),
      resolveTextField(
        tjeneste.forventninger_til_bruker_plain_text,
        tjeneste.forventninger_til_bruker
      ),
      ...(tjeneste.lovhjemmel || []).map((lovhjemmel) => lovhjemmel.lov),
      ...(tjeneste.kontaktpunkter || []).flatMap((kontakt) => [
        kontakt.beskrivelse,
        kontakt.verdi,
      ]),
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function pickRelevantTjenester(question: string, tjenester: Tjeneste[]): Tjeneste[] {
  const normalizedQuestion = normalizeForSearch(question);
  const terms = extractSearchTerms(question);

  const scored = tjenester
    .map((tjeneste) => {
      const searchText = buildServiceSearchText(tjeneste);
      let score = 0;

      if (normalizedQuestion && searchText.includes(normalizedQuestion)) {
        score += 20;
      }

      for (const term of terms) {
        if (searchText.includes(term)) {
          score += term.length >= 6 ? 4 : 2;
        }
      }

      if (normalizeForSearch(tjeneste.navn).includes(normalizedQuestion)) {
        score += 8;
      }

      return { tjeneste, score };
    })
    .sort((a, b) => b.score - a.score || a.tjeneste.navn.localeCompare(b.tjeneste.navn, "nb"));

  const matched = scored
    .filter((item) => item.score > 0)
    .slice(0, MAX_DETAILED_CONTEXT_SERVICES)
    .map((item) => item.tjeneste);

  if (matched.length > 0) {
    return matched;
  }

  return scored.slice(0, MAX_DETAILED_CONTEXT_SERVICES).map((item) => item.tjeneste);
}

function buildGeminiContext(
  allTjenester: Tjeneste[],
  detailedTjenester: Tjeneste[],
  totalServices: number
) {
  return {
    metadata: {
      total_tjenester: totalServices,
      katalog_i_prompt: allTjenester.length,
      detaljer_i_prompt: detailedTjenester.length,
      kilde: "server/data/tjenester.json",
    },
    katalog: allTjenester.map((tjeneste) => ({
      id: tjeneste.id,
      navn: tjeneste.navn,
      kort_navn: tjeneste.kort_navn,
      kategori_sti: tjeneste.kategori_sti,
      temaer: tjeneste.temaer,
      tjenestetype: tjeneste.tjenestetype,
      vedtaksbasert: tjeneste.vedtaksbasert,
      lavterskel: tjeneste.lavterskel,
      trinn_nivå: tjeneste.trinn_nivå,
      status: tjeneste.status,
    })),
    tjeneste_detaljer: detailedTjenester.map((tjeneste) => ({
      id: tjeneste.id,
      navn: tjeneste.navn,
      kort_navn: tjeneste.kort_navn,
      kategori_sti: tjeneste.kategori_sti,
      temaer: tjeneste.temaer,
      tjenestetype: tjeneste.tjenestetype,
      vedtaksbasert: tjeneste.vedtaksbasert,
      lavterskel: tjeneste.lavterskel,
      trinn_nivå: tjeneste.trinn_nivå,
      målgruppe: tjeneste.målgruppe,
      leverandør_type: tjeneste.leverandør_type,
      leverandør_organisasjoner: tjeneste.leverandør_organisasjoner,
      geografi: tjeneste.geografi,
      for_du_søker: clipText(
        resolveTextField(tjeneste.for_du_søker_plain_text, tjeneste.for_du_søker)
      ),
      beskrivelse: clipText(tjeneste.beskrivelse_plain_text || tjeneste.beskrivelse),
      tildelingskriterier: clipText(
        resolveTextField(tjeneste.tildelingskriterier_plain_text, tjeneste.tildelingskriterier)
      ),
      dette_inngår_ikke_i_tjenestetilbudet: clipText(
        resolveTextField(
          tjeneste.dette_inngår_ikke_i_tjenestetilbudet_plain_text,
          tjeneste.dette_inngår_ikke_i_tjenestetilbudet
        )
      ),
      hva_kan_du_forvente: clipText(
        resolveTextField(tjeneste.hva_kan_du_forvente_plain_text, tjeneste.hva_kan_du_forvente)
      ),
      forventninger_til_bruker: clipText(
        resolveTextField(
          tjeneste.forventninger_til_bruker_plain_text,
          tjeneste.forventninger_til_bruker
        )
      ),
      vedtak: tjeneste.vedtak,
      evaluering: tjeneste.evaluering,
      pris: tjeneste.pris,
      lovhjemmel: tjeneste.lovhjemmel,
      kontaktpunkter: tjeneste.kontaktpunkter,
      eksterne_lenker: tjeneste.eksterne_lenker,
      status: tjeneste.status,
    })),
  };
}

function parseGuardrailJson(value: string): GuardrailDecision | null {
  const candidates = [value.trim()];
  const jsonMatch = value.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    candidates.push(jsonMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as Partial<GuardrailDecision>;
      if (typeof parsed.allow === "boolean") {
        return {
          allow: parsed.allow,
          reason: typeof parsed.reason === "string" ? parsed.reason.trim() : "",
        };
      }
    } catch {
      // Continue trying other parse candidates
    }
  }

  return null;
}

async function runLocalGuardrail(
  question: string,
  debug?: DebugCollector
): Promise<GuardrailDecision> {
  const controller = new AbortController();
  const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, PRIVACY_TIMEOUT_MS);
  const startedMs = Date.now();
  const startedAtIso = new Date(startedMs).toISOString();
  const requestBody = {
    model: PRIVACY_MODEL,
    stream: false,
    messages: [
      {
        role: "system",
        content:
          "Du er en personvernvakt. Vurder om teksten inneholder sensitiv personinformasjon som ikke skal sendes til offentlig LLM. " +
          "Sensitivt inkluderer blant annet personnummer/fødselsnummer, telefonnummer, e-post, bankkonto, kortnummer, " +
          "detaljerte helseopplysninger og annen identifiserbar personinfo. Svar KUN med gyldig JSON på én linje: " +
          '{"allow":true,"reason":""} eller {"allow":false,"reason":"kort begrunnelse på norsk"}.',
      },
      {
        role: "user",
        content: question,
      },
    ],
    options: {
      temperature: 0,
    },
  };
  let responseStatus: number | undefined;
  let responseRaw = "";

  try {
    const response = await fetch(PRIVACY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(requestBody),
    });
    responseStatus = response.status;
    responseRaw = await response.text();

    if (!response.ok) {
      throw new Error(`Local guardrail failed with ${response.status}`);
    }

    const data = tryParseJson(responseRaw) as {
      message?: { content?: string };
      response?: string;
    };

    const rawText = data.message?.content || data.response || "";
    const parsed = parseGuardrailJson(rawText);
    if (!parsed) {
      throw new Error("Could not parse local guardrail response");
    }

    debug?.add({
      step: "privacy",
      provider: "ollama",
      model: PRIVACY_MODEL,
      url: PRIVACY_ENDPOINT,
      requestBody,
      responseStatus,
      responseBody: tryParseJson(responseRaw),
      startedAt: startedAtIso,
      durationMs: Date.now() - startedMs,
    });

    return parsed;
  } catch (error) {
    debug?.add({
      step: "privacy",
      provider: "ollama",
      model: PRIVACY_MODEL,
      url: PRIVACY_ENDPOINT,
      requestBody,
      responseStatus,
      responseBody: responseRaw ? tryParseJson(responseRaw) : undefined,
      startedAt: startedAtIso,
      durationMs: Date.now() - startedMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildOpenAIChatCompletionsUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed;
  }
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/chat/completions`;
  }
  return `${trimmed}/chat/completions`;
}

function extractOpenAIMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .join("\n");
  }
  return "";
}

async function runOpenAIGuardrail(
  question: string,
  debug?: DebugCollector
): Promise<GuardrailDecision> {
  const controller = new AbortController();
  const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, PRIVACY_TIMEOUT_MS);
  const startedMs = Date.now();
  const startedAtIso = new Date(startedMs).toISOString();
  const url = buildOpenAIChatCompletionsUrl(PRIVACY_ENDPOINT);
  const requestBody = {
    model: PRIVACY_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Du er en personvernvakt. Vurder om teksten inneholder sensitiv personinformasjon som ikke skal sendes til offentlig LLM. " +
          "Sensitivt inkluderer blant annet personnummer/fødselsnummer, telefonnummer, e-post, bankkonto, kortnummer, " +
          "detaljerte helseopplysninger og annen identifiserbar personinfo. Svar KUN med gyldig JSON på én linje: " +
          '{"allow":true,"reason":""} eller {"allow":false,"reason":"kort begrunnelse på norsk"}.',
      },
      {
        role: "user",
        content: question,
      },
    ],
    temperature: 0,
    max_tokens: 120,
  };
  let responseStatus: number | undefined;
  let responseRaw = "";

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(PRIVACY_API_KEY ? { Authorization: `Bearer ${PRIVACY_API_KEY}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify(requestBody),
    });
    responseStatus = response.status;

    responseRaw = await response.text();
    if (!response.ok) {
      throw new Error(
        `OpenAI guardrail failed with ${response.status}: ${responseRaw.slice(0, 250)}`
      );
    }

    const data = tryParseJson(responseRaw) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const rawText = extractOpenAIMessageContent(data.choices?.[0]?.message?.content || "");
    const parsed = parseGuardrailJson(rawText);
    if (!parsed) {
      throw new Error("Could not parse OpenAI guardrail response");
    }

    debug?.add({
      step: "privacy",
      provider: "openai-compatible",
      model: PRIVACY_MODEL,
      url,
      requestBody,
      responseStatus,
      responseBody: tryParseJson(responseRaw),
      startedAt: startedAtIso,
      durationMs: Date.now() - startedMs,
    });

    return parsed;
  } catch (error) {
    debug?.add({
      step: "privacy",
      provider: "openai-compatible",
      model: PRIVACY_MODEL,
      url,
      requestBody,
      responseStatus,
      responseBody: responseRaw ? tryParseJson(responseRaw) : undefined,
      startedAt: startedAtIso,
      durationMs: Date.now() - startedMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function runPrivacyGuardrail(
  question: string,
  debug?: DebugCollector
): Promise<GuardrailDecision> {
  if (PRIVACY_LLM_PROVIDER === "openai") {
    return runOpenAIGuardrail(question, debug);
  }
  return runLocalGuardrail(question, debug);
}

function detectSensitiveWithRegex(question: string): string | null {
  const checks: Array<{ pattern: RegExp; reason: string }> = [
    { pattern: /\b\d{11}\b/, reason: "personnummer/fødselsnummer" },
    { pattern: /(?:\+47\s?)?\b\d{8}\b/, reason: "telefonnummer" },
    {
      pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
      reason: "epostadresse",
    },
    {
      pattern: /\b(?:\d[ -]?){13,19}\b/,
      reason: "kortnummer/betalingsinformasjon",
    },
    { pattern: /\b\d{4}\s?\d{2}\s?\d{5}\b/, reason: "bankkontonummer" },
  ];

  for (const check of checks) {
    if (check.pattern.test(question)) {
      return check.reason;
    }
  }
  return null;
}

async function askGemini(
  question: string,
  context: unknown,
  geminiApiKey: string,
  debug?: DebugCollector
): Promise<string> {
  const requestUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
  const debugUrl =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=REDACTED`;
  const startedMs = Date.now();
  const startedAtIso = new Date(startedMs).toISOString();

  const generationConfig: {
    temperature: number;
    maxOutputTokens: number;
    responseMimeType: string;
    thinkingConfig?: { thinkingBudget: number };
  } = {
    temperature: 0,
    maxOutputTokens: 1200,
    responseMimeType: "text/plain",
  };

  if (Number.isFinite(GEMINI_THINKING_BUDGET) && GEMINI_THINKING_BUDGET > 0) {
    generationConfig.thinkingConfig = {
      thinkingBudget: GEMINI_THINKING_BUDGET,
    };
  }

  const requestBody = {
    system_instruction: {
      parts: [
        {
          text:
            "Du er en assistent for Tjenesteguide. Du skal KUN svare basert på JSON-data som følger i brukerprompten. " +
            "Ikke bruk ekstern kunnskap. Hvis svaret ikke finnes i dataene, svar nøyaktig: " +
            '"Det finner jeg ikke i tjenestedataene." Svar på norsk bokmål. ' +
            "Bruk først katalogen for å finne relevante tjenester, og bruk tjeneste_detaljer for selve svaret.",
        },
      ],
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text:
              `Spørsmål fra bruker:\n${question}\n\n` +
              `Datagrunnlag (JSON):\n${JSON.stringify(context)}`,
          },
        ],
      },
    ],
    generationConfig,
  };
  let responseStatus: number | undefined;
  let raw = "";

  try {
    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });
    responseStatus = response.status;

    raw = await response.text();
    if (!response.ok) {
      let detail = raw.slice(0, 400);
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } };
        if (parsed.error?.message) {
          detail = parsed.error.message;
        }
      } catch {
        // Keep raw excerpt when body is not JSON.
      }
      throw new Error(`Gemini error (${response.status}): ${detail}`);
    }

    const parsed = JSON.parse(raw) as GeminiGenerateContentResponse;

    const answer = (parsed.candidates || [])
      .flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!answer) {
      const finishReasons = (parsed.candidates || [])
        .map((candidate) => candidate.finishReason)
        .filter(Boolean)
        .join(",");
      const blockReason =
        parsed.promptFeedback?.blockReasonMessage || parsed.promptFeedback?.blockReason || "";
      const detailParts = [
        finishReasons ? `finishReason=${finishReasons}` : "",
        blockReason ? `blockReason=${blockReason}` : "",
      ].filter(Boolean);
      const detail = detailParts.length > 0 ? ` (${detailParts.join(" | ")})` : "";
      throw new Error(
        `Gemini returned an empty response${detail}. Raw excerpt: ${raw.slice(0, 320)}`
      );
    }

    debug?.add({
      step: "gemini",
      provider: "gemini",
      model: GEMINI_MODEL,
      url: debugUrl,
      requestBody,
      responseStatus,
      responseBody: tryParseJson(raw),
      startedAt: startedAtIso,
      durationMs: Date.now() - startedMs,
    });

    return answer;
  } catch (error) {
    debug?.add({
      step: "gemini",
      provider: "gemini",
      model: GEMINI_MODEL,
      url: debugUrl,
      requestBody,
      responseStatus,
      responseBody: raw ? tryParseJson(raw) : undefined,
      startedAt: startedAtIso,
      durationMs: Date.now() - startedMs,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

router.post("/ask", async (req: Request, res: Response) => {
  let debug: DebugCollector | undefined;
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const debugRequested = req.body?.debug === true;
    debug = createDebugCollector(debugRequested);
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }
    if (message.length > MAX_QUESTION_LENGTH) {
      return res.status(400).json({
        error: `message is too long (max ${MAX_QUESTION_LENGTH} tegn)`,
      });
    }

    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return res.json({
        blocked: true,
        warning:
          "GEMINI_API_KEY mangler i servermiljøet. Legg den til og restart server/container.",
        ...(debug.enabled ? { debug: { traces: debug.traces } } : {}),
      });
    }

    let guardrailDecision: GuardrailDecision;
    try {
      guardrailDecision = await runPrivacyGuardrail(message, debug);
    } catch (error) {
      console.error("Privacy guardrail error:", error);
      if (PRIVACY_REQUIRED) {
        return res.json({
          blocked: true,
          warning:
            "Personvernkontroll er ikke tilgjengelig. Sjekk privacy-modell/endepunkt og prøv igjen.",
          details: `${error}`,
          ...(debug.enabled ? { debug: { traces: debug.traces } } : {}),
        });
      }

      const regexReason = detectSensitiveWithRegex(message);
      if (regexReason) {
        return res.json({
          blocked: true,
          warning:
            `Meldingen ser ut til å inneholde sensitiv informasjon (${regexReason}). ` +
            "Fjern dette og prøv igjen.",
          ...(debug.enabled ? { debug: { traces: debug.traces } } : {}),
        });
      }
      guardrailDecision = { allow: true, reason: "Allowed by regex fallback" };
    }

    if (!guardrailDecision.allow) {
      return res.json({
        blocked: true,
        warning:
          guardrailDecision.reason ||
          "Meldingen ser ut til å inneholde sensitiv personinformasjon. " +
            "Fjern persondata og prøv igjen.",
        ...(debug.enabled ? { debug: { traces: debug.traces } } : {}),
      });
    }

    const allTjenester = await getAllTjenester();
    const detailedTjenester = pickRelevantTjenester(message, allTjenester);
    const context = buildGeminiContext(allTjenester, detailedTjenester, allTjenester.length);
    const answer = await askGemini(message, context, geminiApiKey, debug);

    return res.json({
      blocked: false,
      answer,
      metadata: {
        total_tjenester: allTjenester.length,
        inkludert_i_prompt: detailedTjenester.length,
        katalog_i_prompt: allTjenester.length,
      },
      ...(debug.enabled ? { debug: { traces: debug.traces } } : {}),
    });
  } catch (error) {
    console.error("Chat error:", error);
    const details = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      error: "Kunne ikke behandle chat-forespørselen",
      details,
      ...(debug?.enabled ? { debug: { traces: debug.traces } } : {}),
    });
  }
});

export default router;
