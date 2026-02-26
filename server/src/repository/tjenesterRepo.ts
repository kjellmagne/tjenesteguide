import { promises as fs } from "fs";
import path from "path";
import { Tjeneste } from "../models/tjeneste";

const DATA_DIR = path.resolve(__dirname, "../../data");
const DATA_FILE = path.join(DATA_DIR, "tjenester.json");

/**
 * Ensure data directory and file exist.
 */
export async function ensureDataFile(): Promise<void> {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    try {
      await fs.access(DATA_FILE);
    } catch {
      // File doesn't exist, create it with empty array
      await fs.writeFile(DATA_FILE, JSON.stringify([], null, 2), "utf-8");
    }
  } catch (error) {
    throw new Error(`Failed to initialize data file: ${error}`);
  }
}

/**
 * Read all tjenester from JSON file.
 */
async function readTjenester(): Promise<Tjeneste[]> {
  await ensureDataFile();
  try {
    const content = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(content) as Tjeneste[];
  } catch (error) {
    throw new Error(`Failed to read tjenester: ${error}`);
  }
}

/**
 * Write all tjenester to JSON file.
 */
async function writeTjenester(tjenester: Tjeneste[]): Promise<void> {
  await ensureDataFile();
  try {
    await fs.writeFile(
      DATA_FILE,
      JSON.stringify(tjenester, null, 2),
      "utf-8"
    );
  } catch (error) {
    throw new Error(`Failed to write tjenester: ${error}`);
  }
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

