import { promises as fs } from "fs";
import path from "path";
import { Tjeneste, TjenesteguideMetadata } from "../models/tjeneste";

const DATA_DIR = path.resolve(__dirname, "../../data");
const DATA_FILE = path.join(DATA_DIR, "tjenester.json");

type TjenesteguideDataFile = {
  metadata: TjenesteguideMetadata;
  tjenester: Tjeneste[];
};

const DEFAULT_GUIDE_DESCRIPTION =
  "Tjenesteguide samler informasjon om tjenester levert av Alta kommune og samarbeidspartnere.";

function encodeUtf8ToBase64(value: string): string {
  return Buffer.from(value, "utf-8").toString("base64");
}

function decodeBase64ToUtf8(value?: string): string {
  if (!value) {
    return "";
  }
  try {
    return Buffer.from(value, "base64").toString("utf-8");
  } catch {
    return "";
  }
}

function stripHtmlToPlainText(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function plainTextToRichHtml(value: string): string {
  if (!value) {
    return "";
  }
  return escapeHtml(value).replace(/\r\n/g, "\n").replace(/\n/g, "<br>");
}

function normalizeTjenesteguideMetadata(
  metadata?: Partial<TjenesteguideMetadata>
): TjenesteguideMetadata {
  const decodedRich = decodeBase64ToUtf8(metadata?.generell_beskrivelse_rich_base64);
  const plainFromRich = decodedRich ? stripHtmlToPlainText(decodedRich) : "";
  const explicitPlain =
    typeof metadata?.generell_beskrivelse_plain_text === "string"
      ? metadata.generell_beskrivelse_plain_text
      : undefined;
  const explicitDescription =
    typeof metadata?.generell_beskrivelse === "string"
      ? metadata.generell_beskrivelse
      : undefined;
  const plain = explicitPlain ?? explicitDescription ?? plainFromRich ?? DEFAULT_GUIDE_DESCRIPTION;
  const richHtml = decodedRich || plainTextToRichHtml(plain);

  return {
    generell_beskrivelse: plain,
    generell_beskrivelse_plain_text: plain,
    generell_beskrivelse_rich_base64: encodeUtf8ToBase64(richHtml),
  };
}

const DEFAULT_METADATA: TjenesteguideMetadata = normalizeTjenesteguideMetadata({
  generell_beskrivelse: DEFAULT_GUIDE_DESCRIPTION,
});

/**
 * Ensure data directory and file exist.
 */
export async function ensureDataFile(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(DATA_FILE);
    } catch {
      await fs.writeFile(
        DATA_FILE,
        JSON.stringify(
          {
            metadata: DEFAULT_METADATA,
            tjenester: [],
          },
          null,
          2
        ),
        "utf-8"
      );
    }
  } catch (error) {
    throw new Error(`Failed to initialize data file: ${error}`);
  }
}

/**
 * Read full data file from JSON, with backward compatibility for legacy array format.
 */
async function readDataFile(): Promise<TjenesteguideDataFile> {
  await ensureDataFile();
  try {
    const content = await fs.readFile(DATA_FILE, "utf-8");
    const parsed = JSON.parse(content) as
      | Tjeneste[]
      | { metadata?: Partial<TjenesteguideMetadata>; tjenester?: Tjeneste[] };

    if (Array.isArray(parsed)) {
      return {
        metadata: DEFAULT_METADATA,
        tjenester: parsed,
      };
    }

    return {
      metadata: normalizeTjenesteguideMetadata(parsed.metadata || {}),
      tjenester: Array.isArray(parsed.tjenester) ? parsed.tjenester : [],
    };
  } catch (error) {
    throw new Error(`Failed to read tjenester: ${error}`);
  }
}

/**
 * Write full data file to JSON.
 */
async function writeDataFile(data: TjenesteguideDataFile): Promise<void> {
  await ensureDataFile();
  try {
    await fs.writeFile(
      DATA_FILE,
      JSON.stringify(data, null, 2),
      "utf-8"
    );
  } catch (error) {
    throw new Error(`Failed to write tjenester: ${error}`);
  }
}

/**
 * Read all tjenester from JSON file.
 */
async function readTjenester(): Promise<Tjeneste[]> {
  const data = await readDataFile();
  return data.tjenester;
}

/**
 * Write all tjenester to JSON file while preserving metadata.
 */
async function writeTjenester(tjenester: Tjeneste[]): Promise<void> {
  const data = await readDataFile();
  await writeDataFile({
    ...data,
    tjenester,
  });
}

export async function getAllTjenester(): Promise<Tjeneste[]> {
  return readTjenester();
}

export async function getTjenesteById(id: string): Promise<Tjeneste | undefined> {
  const tjenester = await readTjenester();
  return tjenester.find((t) => t.id === id);
}

export async function saveAllTjenester(tjenester: Tjeneste[]): Promise<void> {
  await writeTjenester(tjenester);
}

export async function getTjenesteguideMetadata(): Promise<TjenesteguideMetadata> {
  const data = await readDataFile();
  return data.metadata;
}

export async function updateTjenesteguideMetadata(
  metadata: TjenesteguideMetadata
): Promise<TjenesteguideMetadata> {
  const data = await readDataFile();
  const nextMetadata = normalizeTjenesteguideMetadata(metadata);

  await writeDataFile({
    ...data,
    metadata: nextMetadata,
  });

  return nextMetadata;
}

function getNextNumericId(tjenester: Tjeneste[]): string {
  const maxExisting = tjenester.reduce((max, tjeneste) => {
    if (!/^\d+$/.test(tjeneste.id)) {
      return max;
    }
    const value = Number.parseInt(tjeneste.id, 10);
    return Number.isNaN(value) ? max : Math.max(max, value);
  }, 0);

  return String(maxExisting + 1).padStart(6, "0");
}

export async function createTjeneste(tjeneste: Tjeneste): Promise<Tjeneste> {
  const tjenester = await readTjenester();
  
  // Check for duplicate ID
  if (tjenester.some((t) => t.id === tjeneste.id)) {
    throw new Error(`Tjeneste with id "${tjeneste.id}" already exists`);
  }
  
  tjenester.push(tjeneste);
  await writeTjenester(tjenester);
  return tjeneste;
}

export async function createTjenesteWithAutoId(
  tjenesteData: Omit<Tjeneste, "id">
): Promise<Tjeneste> {
  const tjenester = await readTjenester();
  const tjeneste: Tjeneste = {
    ...tjenesteData,
    id: getNextNumericId(tjenester),
  };

  tjenester.push(tjeneste);
  await writeTjenester(tjenester);
  return tjeneste;
}

export async function updateTjeneste(
  id: string,
  updatedTjeneste: Tjeneste
): Promise<Tjeneste> {
  const tjenester = await readTjenester();
  const index = tjenester.findIndex((t) => t.id === id);
  
  if (index === -1) {
    throw new Error(`Tjeneste with id "${id}" not found`);
  }
  
  // Ensure ID matches
  updatedTjeneste.id = id;
  tjenester[index] = updatedTjeneste;
  await writeTjenester(tjenester);
  return updatedTjeneste;
}

export async function deleteTjeneste(id: string): Promise<void> {
  const tjenester = await readTjenester();
  const index = tjenester.findIndex((t) => t.id === id);
  
  if (index === -1) {
    throw new Error(`Tjeneste with id "${id}" not found`);
  }
  
  tjenester.splice(index, 1);
  await writeTjenester(tjenester);
}

