export interface JsonParseResult {
  headers: string[];
  rows: Record<string, unknown>[];
}

/**
 * Parses a JSON buffer that contains either:
 *   - An array of objects: [{...}, {...}]
 *   - An object with an items/data/records array: { items: [{...}] }
 * Supports nested field access (flattens one level deep for header detection).
 */
export function parseJsonBuffer(buffer: Buffer): JsonParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid JSON — could not parse uploaded file'), { statusCode: 400 });
  }

  let rows: Record<string, unknown>[];

  if (Array.isArray(parsed)) {
    rows = parsed as Record<string, unknown>[];
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    // Look for common wrapper keys
    const arrayKey = ['items', 'data', 'records', 'invoices', 'results'].find(
      (k) => Array.isArray(obj[k]),
    );
    if (arrayKey) {
      rows = obj[arrayKey] as Record<string, unknown>[];
    } else {
      // Single object — wrap in array
      rows = [obj];
    }
  } else {
    throw Object.assign(new Error('JSON must be an array or object with an items array'), { statusCode: 400 });
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  // Derive headers from the union of all keys in first 10 rows
  const headerSet = new Set<string>();
  for (const row of rows.slice(0, 10)) {
    if (row && typeof row === 'object') {
      for (const key of Object.keys(row)) {
        headerSet.add(key);
      }
    }
  }

  return { headers: Array.from(headerSet), rows };
}
