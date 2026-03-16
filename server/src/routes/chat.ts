import express, { Request, Response as ExpressResponse } from "express";
import { getAllTjenester, getTjenesteguideMetadata } from "../repository/tjenesterRepo";
import { Tjeneste, TjenesteguideMetadata } from "../models/tjeneste";

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
const MAX_HISTORY_MESSAGES = Number.parseInt(process.env.MAX_HISTORY_MESSAGES || "20", 10);
const MAX_HISTORY_TEXT_CHARS = Number.parseInt(process.env.MAX_HISTORY_TEXT_CHARS || "700", 10);
const GEMINI_THINKING_BUDGET = Number.parseInt(
  process.env.GEMINI_THINKING_BUDGET || "256",
  10
);
const LLM_STATUS_TIMEOUT_MS = Number.parseInt(
  process.env.LLM_STATUS_TIMEOUT_MS || "5000",
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

type ChatHistoryMessage = {
  role: "user" | "assistant";
  text: string;
};

type GeminiAnswerPayload = {
  answer: string;
  followUpQuestions: string[];
};

type FollowUpTopic =
  | "apply"
  | "contact"
  | "openingHours"
  | "price"
  | "eligibility"
  | "audience"
  | "beforeApply"
  | "expectations"
  | "law"
  | "links";

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

type LlmHealthStatus = {
  ready: boolean;
  label: string;
  details?: string;
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

function sanitizeHistory(value: unknown): ChatHistoryMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const sanitized: ChatHistoryMessage[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const role = (item as { role?: unknown }).role;
    const text = (item as { text?: unknown }).text;
    if ((role !== "user" && role !== "assistant") || typeof text !== "string") {
      continue;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      continue;
    }
    sanitized.push({
      role,
      text: clipText(trimmed, MAX_HISTORY_TEXT_CHARS),
    });
  }

  return sanitized.slice(-MAX_HISTORY_MESSAGES);
}

function normalizeFollowUpQuestion(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160) {
    return null;
  }

  const lowered = trimmed.toLowerCase();
  if (
    lowered.startsWith("vil du ") ||
    lowered.startsWith("ønsker du ") ||
    lowered.startsWith("onsker du ") ||
    lowered.startsWith("skal jeg ") ||
    lowered.startsWith("vil du at jeg ")
  ) {
    return null;
  }

  return /[?؟]$/.test(trimmed) ? trimmed : `${trimmed}?`;
}

function sanitizeFollowUpQuestions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  const sanitized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = normalizeFollowUpQuestion(item);
    if (!normalized) {
      continue;
    }
    if (!unique.has(normalized)) {
      unique.add(normalized);
      sanitized.push(normalized);
    }
  }

  return sanitized.slice(0, 3);
}

function parseGeminiAnswerPayload(rawAnswer: string): GeminiAnswerPayload {
  const trimmed = rawAnswer.trim();
  if (!trimmed) {
    throw new Error("Gemini returned an empty answer payload");
  }

  const candidates = [trimmed];
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    candidates.push(jsonMatch[0]);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as {
        answer?: unknown;
        follow_up_questions?: unknown;
        followUpQuestions?: unknown;
      };
      const answer = typeof parsed.answer === "string" ? parsed.answer.trim() : "";
      if (!answer) {
        continue;
      }

      return {
        answer,
        followUpQuestions: sanitizeFollowUpQuestions(
          parsed.follow_up_questions ?? parsed.followUpQuestions
        ),
      };
    } catch {
      // Try next candidate.
    }
  }

  return {
    answer: trimmed,
    followUpQuestions: [],
  };
}

function buildFallbackFollowUpQuestions(
  question: string,
  tjenester: Tjeneste[],
  answer: string
): string[] {
  const unique = new Set<string>();
  const suggestions: string[] = [];
  const primary = tjenester[0];
  const normalizedQuestion = normalizeForSearch(question);
  const answerMentionsContact = /kontakt|ringe|telefon|epost|e-post/i.test(answer);

  const push = (value?: string) => {
    const normalized = value ? normalizeFollowUpQuestion(value) : null;
    if (!normalized || unique.has(normalized)) {
      return;
    }
    unique.add(normalized);
    suggestions.push(normalized);
  };

  if (primary) {
    const askedAboutApplying =
      normalizedQuestion.includes("søk") ||
      normalizedQuestion.includes("sok") ||
      normalizedQuestion.includes("søknad") ||
      normalizedQuestion.includes("soknad");
    const askedAboutContact =
      normalizedQuestion.includes("kontakt") ||
      normalizedQuestion.includes("telefon") ||
      normalizedQuestion.includes("ringe") ||
      normalizedQuestion.includes("epost") ||
      normalizedQuestion.includes("e post");
    const askedAboutPrice =
      normalizedQuestion.includes("pris") ||
      normalizedQuestion.includes("koster") ||
      normalizedQuestion.includes("egenandel");
    const askedAboutEligibility =
      normalizedQuestion.includes("innvilg") ||
      normalizedQuestion.includes("vedtak") ||
      normalizedQuestion.includes("krav") ||
      normalizedQuestion.includes("kriter") ||
      normalizedQuestion.includes("få ");
    const askedAboutAudience =
      normalizedQuestion.includes("målgruppe") ||
      normalizedQuestion.includes("malgruppe") ||
      normalizedQuestion.includes("hvem") ||
      normalizedQuestion.includes("passer");

    if ((primary.vedtak?.krever_søknad || primary.vedtaksbasert || primary.vedtak?.søknadsvei) && !askedAboutApplying) {
      push(`Hvordan søker jeg om ${primary.navn}`);
    }

    if ((primary.kontaktpunkter || []).length > 0 && answerMentionsContact && !askedAboutContact) {
      push(`Hvordan kan jeg kontakte ${primary.navn}`);
    }

    if (primary.pris && primary.pris.betalingstype !== "gratis" && !askedAboutPrice) {
      push(`Koster ${primary.navn} noe`);
    }

    if (primary.vedtaksbasert && !askedAboutEligibility) {
      push(`Hva må til for å få ${primary.navn}`);
    }

    if ((primary.målgruppe || []).length > 0 && !askedAboutAudience) {
      push(`Hvem passer ${primary.navn} for`);
    }
  }

  return suggestions.slice(0, 3);
}

function looksLikeClosingMessage(message: string): boolean {
  const normalized = normalizeForSearch(message);
  if (!normalized) {
    return false;
  }

  const exactMatches = new Set([
    "takk",
    "tusen takk",
    "mange takk",
    "hjertelig takk",
    "ok takk",
    "okei takk",
    "okay takk",
    "greit takk",
    "flott takk",
    "supert takk",
    "fint takk",
    "bra takk",
    "det var alt",
    "det var det",
    "ingen flere spørsmål",
    "ingen flere sporsmal",
    "ikke flere spørsmål",
    "ikke flere sporsmal",
    "ha det",
    "hade",
    "farvel",
    "snakkes",
    "vi snakkes",
    "takk for hjelpen",
    "tusen takk for hjelpen",
    "mange takk for hjelpen",
  ]);

  if (exactMatches.has(normalized)) {
    return true;
  }

  if (
    /^(takk|tusen takk|mange takk|hjertelig takk)( for hjelpen)?( da)?$/.test(normalized) ||
    /^(ok|okei|okay|greit|flott|supert|fint|bra) takk( da)?$/.test(normalized) ||
    /^(det var alt|det var det|ingen flere spørsmål|ingen flere sporsmal|ikke flere spørsmål|ikke flere sporsmal)( takk)?$/.test(normalized) ||
    /^(ha det|hade|farvel|snakkes|vi snakkes)( da)?$/.test(normalized) ||
    /^(takk|tusen takk|mange takk).*(ha det|snakkes|vi snakkes|farvel)$/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function looksLikeAcknowledgementMessage(message: string): boolean {
  if (/[?؟]/.test(message)) {
    return false;
  }

  const normalized = normalizeForSearch(message);
  if (!normalized) {
    return false;
  }

  const exactMatches = new Set([
    "ok",
    "okei",
    "okay",
    "greit",
    "flott",
    "supert",
    "fint",
    "bra",
    "skjønner",
    "skjonner",
    "forstår",
    "forstar",
    "skjønner det",
    "skjonner det",
    "forstår det",
    "forstar det",
    "ok da",
    "greit da",
    "fint da",
    "bra da",
    "supert da",
    "flott da",
    "ja ok",
    "ja greit",
    "ja fint",
    "ja bra",
    "det skjønner jeg",
    "det skjonner jeg",
    "det forstår jeg",
    "det forstar jeg",
  ]);

  if (exactMatches.has(normalized)) {
    return true;
  }

  return (
    /^(ok|okei|okay|greit|flott|supert|fint|bra)( da)?$/.test(normalized) ||
    /^(skjønner|skjonner|forstår|forstar)( det)?$/.test(normalized) ||
    /^(det skjønner jeg|det skjonner jeg|det forstår jeg|det forstar jeg)$/.test(normalized)
  );
}

function shouldSuppressFollowUps(message: string): boolean {
  return looksLikeClosingMessage(message) || looksLikeAcknowledgementMessage(message);
}

function detectFollowUpTopics(text: string): Set<FollowUpTopic> {
  const normalized = normalizeForSearch(text);
  const topics = new Set<FollowUpTopic>();

  if (
    normalized.includes("søk") ||
    normalized.includes("sok") ||
    normalized.includes("søknad") ||
    normalized.includes("soknad")
  ) {
    topics.add("apply");
  }

  if (
    normalized.includes("kontakt") ||
    normalized.includes("telefon") ||
    normalized.includes("ringe") ||
    normalized.includes("epost") ||
    normalized.includes("e post") ||
    normalized.includes("e-post")
  ) {
    topics.add("contact");
  }

  if (
    normalized.includes("åpningstid") ||
    normalized.includes("apningstid") ||
    normalized.includes("åpent") ||
    normalized.includes("apent")
  ) {
    topics.add("openingHours");
  }

  if (
    normalized.includes("pris") ||
    normalized.includes("koster") ||
    normalized.includes("egenandel") ||
    normalized.includes("betaling")
  ) {
    topics.add("price");
  }

  if (
    normalized.includes("innvilg") ||
    normalized.includes("vedtak") ||
    normalized.includes("krav") ||
    normalized.includes("kriter") ||
    normalized.includes("få ") ||
    normalized.includes("fa ")
  ) {
    topics.add("eligibility");
  }

  if (
    normalized.includes("målgruppe") ||
    normalized.includes("malgruppe") ||
    normalized.includes("hvem") ||
    normalized.includes("passer for")
  ) {
    topics.add("audience");
  }

  if (
    normalized.includes("før du søker") ||
    normalized.includes("for du søker") ||
    normalized.includes("før jeg søker") ||
    normalized.includes("for jeg søker")
  ) {
    topics.add("beforeApply");
  }

  if (
    normalized.includes("forvente") ||
    normalized.includes("forventning") ||
    normalized.includes("hva skjer") ||
    normalized.includes("hvordan blir")
  ) {
    topics.add("expectations");
  }

  if (
    normalized.includes("lov") ||
    normalized.includes("paragraf") ||
    normalized.includes("lovhjemmel") ||
    normalized.includes("rettighet")
  ) {
    topics.add("law");
  }

  if (
    normalized.includes("lenke") ||
    normalized.includes("link") ||
    normalized.includes("nettside") ||
    normalized.includes("hjemmeside") ||
    normalized.includes("mer informasjon") ||
    normalized.includes("lese mer")
  ) {
    topics.add("links");
  }

  return topics;
}

function getAvailableFollowUpTopics(tjenester: Tjeneste[]): Set<FollowUpTopic> {
  const topics = new Set<FollowUpTopic>();

  for (const tjeneste of tjenester) {
    if (
      tjeneste.vedtak?.krever_søknad ||
      tjeneste.vedtak?.søknadsvei ||
      tjeneste.vedtak?.søknad_url ||
      tjeneste.vedtaksbasert
    ) {
      topics.add("apply");
    }

    if ((tjeneste.kontaktpunkter || []).length > 0) {
      topics.add("contact");
    }

    if ((tjeneste.kontaktpunkter || []).some((kontakt) => (kontakt.åpningstid || "").trim())) {
      topics.add("openingHours");
    }

    if (tjeneste.pris && (tjeneste.pris.betalingstype !== "gratis" || tjeneste.pris.beskrivelse)) {
      topics.add("price");
    }

    if (
      tjeneste.vedtaksbasert ||
      resolveTextField(tjeneste.tildelingskriterier_plain_text, tjeneste.tildelingskriterier)
    ) {
      topics.add("eligibility");
    }

    if ((tjeneste.målgruppe || []).length > 0) {
      topics.add("audience");
    }

    if (resolveTextField(tjeneste.for_du_søker_plain_text, tjeneste.for_du_søker)) {
      topics.add("beforeApply");
    }

    if (
      resolveTextField(tjeneste.hva_kan_du_forvente_plain_text, tjeneste.hva_kan_du_forvente) ||
      resolveTextField(
        tjeneste.forventninger_til_bruker_plain_text,
        tjeneste.forventninger_til_bruker
      )
    ) {
      topics.add("expectations");
    }

    if ((tjeneste.lovhjemmel || []).length > 0) {
      topics.add("law");
    }

    if (
      (tjeneste.eksterne_lenker || []).length > 0 ||
      tjeneste.vedtak?.søknad_url ||
      tjeneste.pris?.prislenke ||
      (tjeneste.lovhjemmel || []).some((lov) => lov.url) ||
      (tjeneste.kontaktpunkter || []).some((kontakt) => kontakt.type === "nettside")
    ) {
      topics.add("links");
    }
  }

  return topics;
}

function buildRelevantServicePhrases(tjenester: Tjeneste[]): string[] {
  const phrases = new Set<string>();

  for (const tjeneste of tjenester) {
    for (const value of [tjeneste.navn, tjeneste.kort_navn, ...(tjeneste.synonymer || [])]) {
      const normalized = normalizeForSearch(value || "");
      if (normalized.length >= 4) {
        phrases.add(normalized);
      }
    }
  }

  return Array.from(phrases);
}

function isGenericFillerSuggestion(normalizedSuggestion: string): boolean {
  const fillerPhrases = [
    "hva gjør jeg videre",
    "hva gjor jeg videre",
    "hva skjer videre",
    "hva nå",
    "hva na",
    "kan du fortelle mer",
    "kan jeg få vite mer",
    "kan jeg fa vite mer",
    "er det noe mer jeg bør vite",
    "er det noe mer jeg bor vite",
    "er det noe annet",
    "hva annet kan være aktuelt",
    "hva annet kan vaere aktuelt",
    "finnes det andre tilbud",
    "finnes det andre tjenester",
  ];

  return fillerPhrases.some(
    (phrase) => normalizedSuggestion === phrase || normalizedSuggestion.startsWith(`${phrase} `)
  );
}

function filterRelevantFollowUpQuestions(
  question: string,
  history: ChatHistoryMessage[],
  tjenester: Tjeneste[],
  candidates: string[]
): string[] {
  if (candidates.length === 0 || tjenester.length === 0) {
    return [];
  }

  const threadText = [...history.slice(-6).map((message) => message.text), question].join(" ");
  const threadTopics = detectFollowUpTopics(threadText);
  const availableTopics = getAvailableFollowUpTopics(tjenester);
  const relevantServicePhrases = buildRelevantServicePhrases(tjenester);
  const threadTerms = new Set(extractSearchTerms(threadText));
  const filtered: string[] = [];
  const unique = new Set<string>();

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeForSearch(candidate);
    if (!normalizedCandidate || isGenericFillerSuggestion(normalizedCandidate)) {
      continue;
    }

    const candidateTopics = detectFollowUpTopics(candidate);
    const mentionsRelevantService = relevantServicePhrases.some(
      (phrase) => phrase && normalizedCandidate.includes(phrase)
    );
    const overlapsThread = extractSearchTerms(candidate).some((term) => threadTerms.has(term));

    let relevant = false;

    if (candidateTopics.size > 0) {
      const hasAvailableTopic = Array.from(candidateTopics).some((topic) =>
        availableTopics.has(topic)
      );
      const introducesNewTopic = Array.from(candidateTopics).some((topic) => !threadTopics.has(topic));

      relevant = hasAvailableTopic && (introducesNewTopic || mentionsRelevantService || overlapsThread);

      if (Array.from(candidateTopics).every((topic) => threadTopics.has(topic))) {
        relevant = false;
      }
    } else {
      relevant = mentionsRelevantService || overlapsThread;
    }

    if (!relevant) {
      continue;
    }

    const normalized = normalizeFollowUpQuestion(candidate);
    if (!normalized || unique.has(normalized)) {
      continue;
    }

    unique.add(normalized);
    filtered.push(normalized);
  }

  return filtered.slice(0, 3);
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
  metadata: TjenesteguideMetadata,
  allTjenester: Tjeneste[],
  detailedTjenester: Tjeneste[],
  totalServices: number
) {
  return {
    metadata: {
      total_tjenester: totalServices,
      katalog_i_prompt: allTjenester.length,
      detaljer_i_prompt: detailedTjenester.length,
      kilde: "Informasjonstjeneste for tjenester levert av Alta kommune og samarbeidspartnere",
    },
    tjenesteguide: {
      generell_beskrivelse: metadata.generell_beskrivelse,
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

function buildPrivacyGuardrailPrompt(): string {
  return (
    "Du er en personvernvakt. Vurder om teksten inneholder sensitiv personinformasjon som ikke skal sendes til offentlig LLM. " +
    "Blokker bare hvis teksten faktisk inneholder identifiserende eller klart private opplysninger om en konkret person. " +
    "Sensitivt inkluderer blant annet personnummer/fødselsnummer, telefonnummer, e-post, bankkonto, kortnummer, adresse, " +
    "detaljerte helseopplysninger, diagnose kombinert med personlige forhold, eller annen identifiserbar personinfo. " +
    "Ikke blokker generelle spørsmål om tjenester, søknadsprosess, vedtak, innvilgelse, avslag, rettigheter, pris, ventetid eller hvordan noe fungerer, " +
    'selv om brukeren skriver "jeg", "vi" eller spør "hva skjer hvis jeg får innvilget tjenesten". ' +
    "Hypotetiske og generelle spørsmål skal tillates. " +
    'Eksempel tillatt: "Hva skjer hvis jeg får innvilget tjenesten?" ' +
    'Eksempel tillatt: "Hvordan søker jeg om denne tjenesten?" ' +
    'Eksempel blokkert: "Jeg heter Kari Hansen, fødselsnummer 12345678910 og har bipolar lidelse." ' +
    'Svar KUN med gyldig JSON på én linje: {"allow":true,"reason":""} eller {"allow":false,"reason":"kort begrunnelse på norsk"}.'
  );
}

function looksLikeGenericServiceQuestion(question: string): boolean {
  const normalized = normalizeForSearch(question);
  const administrativeKeywords = [
    "innvilget",
    "avslag",
    "vedtak",
    "soknad",
    "soke",
    "tjeneste",
    "tjenesten",
    "rettighet",
    "rettigheter",
    "pris",
    "koster",
    "ventetid",
    "behandlingstid",
    "kontakt",
    "klage",
    "hva skjer",
    "hvordan fungerer",
    "hvordan soker",
    "kan jeg fa",
    "hvor lang tid",
  ];
  const firstPersonPattern = /\b(jeg|meg|min|mine|mitt|vi|oss|vår|vårt|våre)\b/i;
  const personalSensitiveTopicPattern =
    /\b(diagnose|sykdom|lidelse|bipolar|depresjon|angst|adhd|autisme|kreft|rus|avhengighet|gravid|vold|overgrep|straff|dom|barnevern|gjeld|okonomi|økonomi)\b/i;

  const hasAdministrativeIntent = administrativeKeywords.some((keyword) =>
    normalized.includes(keyword)
  );
  const hasDirectIdentifier = detectSensitiveWithRegex(question) !== null;
  const hasPersonalSensitiveTopic =
    firstPersonPattern.test(question) && personalSensitiveTopicPattern.test(normalized);

  return hasAdministrativeIntent && !hasDirectIdentifier && !hasPersonalSensitiveTopic;
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
        content: buildPrivacyGuardrailPrompt(),
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

function buildOpenAIModelsUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/chat/completions")) {
    return trimmed.replace(/\/chat\/completions$/, "/models");
  }
  if (trimmed.endsWith("/v1")) {
    return `${trimmed}/models`;
  }
  return `${trimmed}/models`;
}

function buildOllamaStatusUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api/tags")) {
    return trimmed;
  }
  const apiIndex = trimmed.indexOf("/api/");
  const base = apiIndex >= 0 ? trimmed.slice(0, apiIndex) : trimmed;
  return `${base}/api/tags`;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<globalThis.Response> {
  const controller = new AbortController();
  const timeout: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
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
        content: buildPrivacyGuardrailPrompt(),
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

async function checkPrivacyLlmStatus(): Promise<LlmHealthStatus> {
  const isOpenAiCompatible = PRIVACY_LLM_PROVIDER === "openai";
  const url = isOpenAiCompatible
    ? buildOpenAIModelsUrl(PRIVACY_ENDPOINT)
    : buildOllamaStatusUrl(PRIVACY_ENDPOINT);

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: "GET",
        headers: {
          ...(PRIVACY_API_KEY ? { Authorization: `Bearer ${PRIVACY_API_KEY}` } : {}),
        },
      },
      LLM_STATUS_TIMEOUT_MS
    );

    if (!response.ok) {
      const body = await response.text();
      return {
        ready: false,
        label: "Privat LLM utilgjengelig",
        details: body.slice(0, 160) || `HTTP ${response.status}`,
      };
    }

    return {
      ready: true,
      label: "Privat LLM klar",
    };
  } catch (error) {
    return {
      ready: false,
      label: "Privat LLM utilgjengelig",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkPublicLlmStatus(): Promise<LlmHealthStatus> {
  const geminiApiKey = process.env.GEMINI_API_KEY;
  if (!geminiApiKey) {
    return {
      ready: false,
      label: "Offentlig LLM mangler nøkkel",
      details: "GEMINI_API_KEY mangler",
    };
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(GEMINI_MODEL)}?key=${encodeURIComponent(geminiApiKey)}`;

  try {
    const response = await fetchWithTimeout(url, { method: "GET" }, LLM_STATUS_TIMEOUT_MS);

    if (!response.ok) {
      const raw = await response.text();
      let detail = raw.slice(0, 160) || `HTTP ${response.status}`;
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } };
        if (parsed.error?.message) {
          detail = parsed.error.message;
        }
      } catch {
        // Keep raw excerpt.
      }

      return {
        ready: false,
        label: "Offentlig LLM utilgjengelig",
        details: detail,
      };
    }

    return {
      ready: true,
      label: "Offentlig LLM klar",
    };
  } catch (error) {
    return {
      ready: false,
      label: "Offentlig LLM utilgjengelig",
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

async function askGemini(
  question: string,
  context: unknown,
  geminiApiKey: string,
  history: ChatHistoryMessage[],
  debug?: DebugCollector
): Promise<GeminiAnswerPayload> {
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
    responseMimeType: "application/json",
  };

  if (Number.isFinite(GEMINI_THINKING_BUDGET) && GEMINI_THINKING_BUDGET > 0) {
    generationConfig.thinkingConfig = {
      thinkingBudget: GEMINI_THINKING_BUDGET,
    };
  }

  const historyContents = history.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.text }],
  }));

  const requestBody = {
    system_instruction: {
      parts: [
        {
          text:
            "Du er Ingunn i Tjenesteguide, en informasjonstjeneste for tjenester levert av Alta kommune og samarbeidspartnere. " +
            "Du skal kun bruke tjenesteinformasjonen som følger i brukerprompten, og ikke bruke ekstern kunnskap. " +
            "Bruk først katalogen for å finne relevante tjenester, og bruk tjeneste_detaljer for selve svaret. " +
            "Svar i varm, tydelig og hverdagslig norsk. Vær forståelig, kind og serviceinnstilt. " +
            "Svar i sammenhengende, naturlig samtaletekst. Unngå punktliste med mindre brukeren ber om det eksplisitt. " +
            'Ikke bruk formuleringer som "Basert på informasjonen jeg har", "I informasjonen jeg har tilgjengelig" eller andre lignende, robotaktige vendinger. ' +
            "Hvis du ikke finner et tydelig svar, si det på en enkel og vennlig måte, for eksempel at du ikke ser noe tydelig om dette her, og tilby hjelp videre. " +
            "Hvis du anbefaler å kontakte en tjeneste, skal du oppgi konkret kontaktinformasjon og åpningstid når det finnes i tjenestedataene. " +
            "Når det finnes relevante lenker til mer informasjon, søknad, lovhjemmel, pris eller nettside i tjenestedataene, skal du ta dem med i svaret. " +
            "Bruk Markdown-lenker når det passer naturlig. " +
            "Bruk gjerne formuleringer i denne stilen når de passer: " +
            '"Dette ser ut til å være en tjeneste som kan passe for ...", ' +
            '"Hvis du vil, kan jeg også se nærmere på ...", ' +
            '"Jeg ser ikke noe tydelig om det her, men jeg kan hjelpe deg å se på ...". ' +
            "Hold tonen rolig, hjelpsom og menneskelig. " +
            "Bygg videre på samtalehistorikken når den finnes. Ikke nevn JSON, filnavn, datastrukturer eller interne feltnavn i svaret. " +
            'Svar alltid som JSON med feltene "answer" og "follow_up_questions". ' +
            '"answer" skal være en streng med selve svaret. ' +
            '"follow_up_questions" skal være en liste med 0 til 3 korte, naturlige oppfølgingsspørsmål formulert som om brukeren selv stiller dem neste gang, for eksempel "Hvordan søker jeg?" og ikke "Vil du at jeg skal forklare hvordan du søker?". ' +
            "Hvis brukerens siste melding bare er en avslutning, høflig avrunding eller kort bekreftelse, som for eksempel takk, tusen takk, ok, greit, fint, ha det, det var alt eller lignende, skal listen være tom. " +
            'Hvis det ikke finnes noen tydelige og relevante oppfølgingsspørsmål, skal listen være tom. Ikke bytt tema. Ikke legg til generelle spørsmål bare for å fylle ut listen.',
        },
      ],
    },
    contents: [
      ...historyContents,
      {
        role: "user",
        parts: [
          {
            text:
              `Spørsmål fra bruker:\n${question}\n\n` +
              `Tjenesteinformasjon:\n${JSON.stringify(context)}`,
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

    const answerText = (parsed.candidates || [])
      .flatMap((candidate) => candidate.content?.parts || [])
      .map((part) => part.text || "")
      .join("\n")
      .trim();

    if (!answerText) {
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

    return parseGeminiAnswerPayload(answerText);
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

router.get("/status", async (_req: Request, res: ExpressResponse) => {
  try {
    const [privacy, publicLlm] = await Promise.all([
      checkPrivacyLlmStatus(),
      checkPublicLlmStatus(),
    ]);

    return res.json({
      checkedAt: new Date().toISOString(),
      privacy,
      public: publicLlm,
    });
  } catch (error) {
    return res.status(500).json({
      error: "Kunne ikke hente LLM-status",
      details: error instanceof Error ? error.message : String(error),
    });
  }
});

router.post("/ask", async (req: Request, res: ExpressResponse) => {
  let debug: DebugCollector | undefined;
  try {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
    const debugRequested = req.body?.debug === true;
    debug = createDebugCollector(debugRequested);
    const history = sanitizeHistory(req.body?.history);
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

    if (!guardrailDecision.allow && looksLikeGenericServiceQuestion(message)) {
      guardrailDecision = {
        allow: true,
        reason: "Allowed generic service question override",
      };
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

    const [allTjenester, tjenesteguideMetadata] = await Promise.all([
      getAllTjenester(),
      getTjenesteguideMetadata(),
    ]);
    const detailedTjenester = pickRelevantTjenester(message, allTjenester);
    const context = buildGeminiContext(
      tjenesteguideMetadata,
      allTjenester,
      detailedTjenester,
      allTjenester.length
    );
    const geminiResponse = await askGemini(message, context, geminiApiKey, history, debug);
    const rawFollowUpQuestions =
      geminiResponse.followUpQuestions.length > 0
        ? geminiResponse.followUpQuestions
        : buildFallbackFollowUpQuestions(message, detailedTjenester, geminiResponse.answer);
    const followUpQuestions = shouldSuppressFollowUps(message)
      ? []
      : filterRelevantFollowUpQuestions(message, history, detailedTjenester, rawFollowUpQuestions);

    return res.json({
      blocked: false,
      answer: geminiResponse.answer,
      followUpQuestions,
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
