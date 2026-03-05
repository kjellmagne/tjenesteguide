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

function resolveTextField(plainText?: string, legacyArray?: string[]): string {
  const value = plainText || (legacyArray || []).join("\n\n");
  return value.trim();
}

function buildGeminiContext(tjenester: Tjeneste[], totalServices: number) {
  return {
    metadata: {
      total_tjenester: totalServices,
      inkludert_i_prompt: tjenester.length,
      kilde: "server/data/tjenester.json",
    },
    tjenester: tjenester.map((tjeneste) => ({
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
      for_du_søker: resolveTextField(tjeneste.for_du_søker_plain_text, tjeneste.for_du_søker),
      beskrivelse: tjeneste.beskrivelse_plain_text || tjeneste.beskrivelse,
      tildelingskriterier: resolveTextField(
        tjeneste.tildelingskriterier_plain_text,
        tjeneste.tildelingskriterier
      ),
      dette_inngår_ikke_i_tjenestetilbudet: resolveTextField(
        tjeneste.dette_inngår_ikke_i_tjenestetilbudet_plain_text,
        tjeneste.dette_inngår_ikke_i_tjenestetilbudet
      ),
      hva_kan_du_forvente: resolveTextField(
        tjeneste.hva_kan_du_forvente_plain_text,
        tjeneste.hva_kan_du_forvente
      ),
      forventninger_til_bruker: resolveTextField(
        tjeneste.forventninger_til_bruker_plain_text,
        tjeneste.forventninger_til_bruker
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

async function runLocalGuardrail(question: string): Promise<GuardrailDecision> {
  const controller = new AbortController();
  const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, PRIVACY_TIMEOUT_MS);

  try {
    const response = await fetch(PRIVACY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
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
      }),
    });

    if (!response.ok) {
      throw new Error(`Local guardrail failed with ${response.status}`);
    }

    const data = (await response.json()) as {
      message?: { content?: string };
      response?: string;
    };

    const rawText = data.message?.content || data.response || "";
    const parsed = parseGuardrailJson(rawText);
    if (!parsed) {
      throw new Error("Could not parse local guardrail response");
    }

    return parsed;
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

async function runOpenAIGuardrail(question: string): Promise<GuardrailDecision> {
  const controller = new AbortController();
  const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, PRIVACY_TIMEOUT_MS);

  try {
    const url = buildOpenAIChatCompletionsUrl(PRIVACY_ENDPOINT);
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(PRIVACY_API_KEY ? { Authorization: `Bearer ${PRIVACY_API_KEY}` } : {}),
      },
      signal: controller.signal,
      body: JSON.stringify({
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
      }),
    });

    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`OpenAI guardrail failed with ${response.status}: ${raw.slice(0, 250)}`);
    }

    const data = JSON.parse(raw) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const rawText = extractOpenAIMessageContent(data.choices?.[0]?.message?.content || "");
    const parsed = parseGuardrailJson(rawText);
    if (!parsed) {
      throw new Error("Could not parse OpenAI guardrail response");
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

async function runPrivacyGuardrail(question: string): Promise<GuardrailDecision> {
  if (PRIVACY_LLM_PROVIDER === "openai") {
    return runOpenAIGuardrail(question);
  }
  return runLocalGuardrail(question);
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
  geminiApiKey: string
): Promise<string> {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      system_instruction: {
        parts: [
          {
            text:
              "Du er en assistent for Tjenesteguide. Du skal KUN svare basert på JSON-data som følger i brukerprompten. " +
              "Ikke bruk ekstern kunnskap. Hvis svaret ikke finnes i dataene, svar nøyaktig: " +
              '"Det finner jeg ikke i tjenestedataene." Svar på norsk bokmål.',
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
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 900,
        responseMimeType: "text/plain",
      },
    }),
  });

  const raw = await response.text();
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

  return answer;
}

router.post("/ask", async (req: Request, res: Response) => {
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
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
      });
    }

    let guardrailDecision: GuardrailDecision;
    try {
      guardrailDecision = await runPrivacyGuardrail(message);
    } catch (error) {
      if (PRIVACY_REQUIRED) {
        return res.json({
          blocked: true,
          warning:
            "Personvernkontroll er ikke tilgjengelig. Sjekk privacy-modell/endepunkt og prøv igjen.",
          details: `${error}`,
        });
      }

      const regexReason = detectSensitiveWithRegex(message);
      if (regexReason) {
        return res.json({
          blocked: true,
          warning:
            `Meldingen ser ut til å inneholde sensitiv informasjon (${regexReason}). ` +
            "Fjern dette og prøv igjen.",
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
      });
    }

    const allTjenester = await getAllTjenester();
    const context = buildGeminiContext(allTjenester, allTjenester.length);
    const answer = await askGemini(message, context, geminiApiKey);

    return res.json({
      blocked: false,
      answer,
      metadata: {
        total_tjenester: allTjenester.length,
        inkludert_i_prompt: allTjenester.length,
      },
    });
  } catch (error) {
    console.error("Chat error:", error);
    const details = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      error: "Kunne ikke behandle chat-forespørselen",
      details,
    });
  }
});

export default router;
