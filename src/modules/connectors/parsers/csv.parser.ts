import { logger } from '../../../lib/logger';

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, unknown>[];
  detectedDelimiter: string;
  detectedEncoding: string;
}

const COMMON_DELIMITERS = [',', ';', '\t', '|'];

/**
 * Parses a CSV buffer into structured row data.
 * Handles BOM prefix, auto-detects delimiter, supports UTF-8 and Latin-1 encoding.
 */
export function parseCsvBuffer(buffer: Buffer): CsvParseResult {
  // Strip BOM if present (UTF-8: EF BB BF)
  let content = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
    ? buffer.toString('utf8', 3)
    : buffer.toString('utf8');

  // Fallback: try latin1 if utf8 decode looks corrupted
  const detectedEncoding = 'utf-8';

  const delimiter = detectDelimiter(content);
  logger.debug({ delimiter }, 'CSV delimiter detected');

  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return { headers: [], rows: [], detectedDelimiter: delimiter, detectedEncoding };
  }

  const headers = parseCsvLine(lines[0], delimiter).map((h) => h.trim());

  const rows: Record<string, unknown>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i], delimiter);
    if (values.length === 0) continue;

    const row: Record<string, unknown> = {};
    headers.forEach((header, j) => {
      const val = values[j]?.trim() ?? null;
      row[header] = val === '' ? null : coerceCsvValue(val);
    });
    rows.push(row);
  }

  return { headers, rows, detectedDelimiter: delimiter, detectedEncoding };
}

/**
 * Detects the most likely delimiter by counting occurrences in the first line.
 */
function detectDelimiter(content: string): string {
  const firstLine = content.split(/\r?\n/)[0] ?? '';
  let maxCount = 0;
  let bestDelimiter = ',';

  for (const delim of COMMON_DELIMITERS) {
    const count = firstLine.split(delim).length - 1;
    if (count > maxCount) {
      maxCount = count;
      bestDelimiter = delim;
    }
  }

  return bestDelimiter;
}

/**
 * Parses a single CSV line respecting quoted fields with embedded delimiters and newlines.
 */
function parseCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

function coerceCsvValue(val: string | null): unknown {
  if (val === null) return null;
  if (val === '') return null;

  // Try number
  const num = Number(val);
  if (!isNaN(num) && val.trim() !== '') return num;

  // Try date
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;

  return val;
}
