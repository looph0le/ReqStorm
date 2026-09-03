import fs from "node:fs";
import path from "node:path";

export interface StoredResult {
  name: string;
  timestamp: string;
  tool: string;
  data: unknown;
}

const RESULTS_DIR = ".reqstorm";

function getResultsDir(): string {
  return path.join(process.cwd(), RESULTS_DIR);
}

function ensureDir(): void {
  const dir = getResultsDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function filePathFor(name: string): string {
  return path.join(getResultsDir(), `${sanitizeName(name)}.json`);
}

export function saveResult(name: string, tool: string, data: unknown): void {
  ensureDir();
  const record: StoredResult = {
    name,
    timestamp: new Date().toISOString(),
    tool,
    data,
  };
  fs.writeFileSync(filePathFor(name), JSON.stringify(record, null, 2));
}

export function loadResult(name: string): StoredResult | null {
  const fp = filePathFor(name);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, "utf-8")) as StoredResult;
  } catch {
    return null;
  }
}

export function listResults(): StoredResult[] {
  const dir = getResultsDir();
  if (!fs.existsSync(dir)) return [];
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  const results: StoredResult[] = [];
  for (const f of files) {
    try {
      results.push(
        JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")) as StoredResult
      );
    } catch {
      // skip corrupt files
    }
  }
  return results.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

export function loadBaseline(name: string): StoredResult | null {
  return loadResult(name);
}

export function deleteResult(name: string): boolean {
  const fp = filePathFor(name);
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  return true;
}
