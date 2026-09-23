import { jsonpathFirst } from './jsonpath.js';

export interface ExtractionMapping {
  [varName: string]: string;
}

export interface VariableSet {
  [name: string]: unknown;
}

export function extractVariables(body: unknown, extract: ExtractionMapping): VariableSet {
  const result: VariableSet = {};
  const doc = typeof body === 'string' ? safeParse(body) : body;

  for (const [varName, jsonPath] of Object.entries(extract)) {
    if (doc === undefined) continue;
    const value = jsonpathFirst(doc, jsonPath);
    if (value !== undefined) {
      result[varName] = value;
    }
  }
  return result;
}

function safeParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return input;
  }
}

export function interpolate(template: string, variables: VariableSet): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key) => {
    const value = lookupKey(variables, key);
    if (value === undefined) return match;
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}

function lookupKey(vars: VariableSet, key: string): unknown {
  const parts = key.split('.');
  let current: unknown = vars;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function flattenVariables(vars: VariableSet): VariableSet {
  return Object.fromEntries(
    Object.entries(vars).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
  );
}
