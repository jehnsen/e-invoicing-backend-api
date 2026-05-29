import * as XLSX from 'xlsx';
import { logger } from '../../../lib/logger';

export interface ParsedSheet {
  sheetName: string;
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface ExcelParseResult {
  sheets: ParsedSheet[];
  detectedHeaderRow: number;
}

/**
 * Parses an Excel (.xlsx/.xls) file buffer into structured row data.
 * Handles multi-sheet workbooks, detects header row heuristically.
 */
export function parseExcelBuffer(buffer: Buffer): ExcelParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw Object.assign(new Error('Unable to parse Excel file — file may be corrupted or in an unsupported format'), { statusCode: 400 });
  }

  const sheets: ParsedSheet[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });

    if (rawRows.length === 0) continue;

    const headerRowIndex = detectHeaderRow(rawRows);
    const headers = (rawRows[headerRowIndex] as unknown[]).map((h, i) =>
      h != null ? String(h).trim() : `Column_${i + 1}`,
    );

    const dataRows = rawRows.slice(headerRowIndex + 1).filter((row) =>
      (row as unknown[]).some((cell) => cell != null && cell !== ''),
    );

    const rows: Record<string, unknown>[] = dataRows.map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((header, i) => {
        obj[header] = (row as unknown[])[i] ?? null;
      });
      return obj;
    });

    logger.debug(
      { sheetName, headerRowIndex, rowCount: rows.length, columnCount: headers.length },
      'Parsed Excel sheet',
    );

    sheets.push({ sheetName, headers, rows });
  }

  return { sheets, detectedHeaderRow: 0 };
}

/**
 * Heuristically detects the header row by finding the first row where
 * most cells are non-empty strings (not numbers or dates).
 */
function detectHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] as unknown[];
    const nonEmpty = row.filter((c) => c != null && c !== '');
    const stringCount = nonEmpty.filter((c) => typeof c === 'string').length;

    if (nonEmpty.length > 0 && stringCount / nonEmpty.length > 0.7) {
      return i;
    }
  }
  return 0;
}

/**
 * Returns only the first N rows for preview/mapping purposes.
 */
export function slicePreviewRows(parsed: ParsedSheet, limit = 5): ParsedSheet {
  return { ...parsed, rows: parsed.rows.slice(0, limit) };
}
