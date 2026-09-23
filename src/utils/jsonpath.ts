import { JSONPath } from 'jsonpath-plus';

export function jsonpathEvaluate(doc: unknown, path: string): unknown[] {
  try {
    const result = JSONPath({
      path,
      json: doc as object,
      wrap: true,
    });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

export function jsonpathFirst(doc: unknown, path: string): unknown {
  const results = jsonpathEvaluate(doc, path);
  return results.length > 0 ? results[0] : undefined;
}
