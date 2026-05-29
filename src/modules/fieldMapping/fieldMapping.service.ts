import OpenAI from 'openai';
import { distance } from 'fastest-levenshtein';
import { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { SuggestMappingBody, SaveMappingTemplateBody } from './fieldMapping.schema';

export interface FieldMappingSuggestion {
  sourceField: string;
  targetField: string;
  confidence: number;
  reason?: string;
}

/**
 * All valid BIR target field names for field mapping.
 * TODO: confirm with BIR — add any additional required fields from final EIS spec
 */
const BIR_TARGET_FIELDS = [
  'invoiceType',        // SI | OR | DI | CN | DN
  'invoiceDate',        // YYYY-MM-DD
  'buyerTin',           // NNN-NNN-NNN-NNNVV
  'buyerName',
  'buyerAddress',
  'buyerEmail',
  'vatType',            // VATABLE | ZERO_RATED | EXEMPT | MIXED
  'description',        // line item description
  'unit',               // line item unit (PC, KG, etc.)
  'quantity',
  'unitPriceCentavos',  // unit price in centavos
  'discountCentavos',
  'vatRateBps',         // 1200 = 12%, 0 = exempt
  'amount',             // total amount (may be in PHP, converted to centavos)
  'remarks',
  'referenceInvoiceNumber',
  'referenceInvoiceDate',
];

/**
 * Suggests field mappings using OpenAI.
 * Falls back to rule-based fuzzy matching (Levenshtein) if OPENAI_API_KEY is not set.
 */
export async function suggestFieldMapping(
  body: SuggestMappingBody,
  tenantId: string,
  prisma: PrismaClient,
): Promise<FieldMappingSuggestion[]> {
  if (!env.OPENAI_API_KEY) {
    logger.warn('OPENAI_API_KEY not set — using fuzzy fallback for field mapping');
    return fuzzyFieldMapping(body.sourceHeaders);
  }

  try {
    return await aiFieldMapping(body);
  } catch (err) {
    logger.error({ err }, 'AI field mapping failed — falling back to fuzzy matcher');
    return fuzzyFieldMapping(body.sourceHeaders);
  }
}

/**
 * Calls the OpenAI Chat Completions API to intelligently map source column headers to BIR fields.
 * Handles Tagalog labels, abbreviated column names, and merged/compound headers.
 */
async function aiFieldMapping(body: SuggestMappingBody): Promise<FieldMappingSuggestion[]> {
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const sampleDataStr = JSON.stringify(body.sampleRows.slice(0, 5), null, 2);
  const headersStr = body.sourceHeaders.join(', ');
  const targetFieldsStr = BIR_TARGET_FIELDS.join(', ');

  const prompt = `You are a data mapping assistant for Philippine BIR (Bureau of Internal Revenue) EIS electronic invoicing compliance.

Given the following source column headers from an uploaded file and sample data rows, suggest the best mapping to the BIR EIS target fields.

## Source Column Headers
${headersStr}

## Sample Data (first 5 rows)
${sampleDataStr}

## Available BIR Target Fields
${targetFieldsStr}

## Instructions
- Map each source column to the most appropriate BIR target field
- Handle Tagalog column names (e.g., "Halaga" = amount, "Dami" = quantity, "Yunit" = unit, "Petsa" = date, "Mamimili" = buyer, "Magtitinda" = seller)
- Handle common abbreviations (e.g., "Qty" = quantity, "Desc" = description, "Amt" = amount, "TIN" = buyerTin)
- Handle merged or compound headers (e.g., "Buyer Name / Address" → map to buyerName, note the partial match)
- Assign a confidence score from 0.0 to 1.0 based on how certain you are of the mapping
- If a source field clearly does not map to any BIR field, omit it
- Return ONLY a JSON array, no explanation

## Required Output Format
[
  { "sourceField": "<source column name>", "targetField": "<bir target field>", "confidence": 0.95, "reason": "<brief reason>" },
  ...
]`;

  const response = await client.chat.completions.create({
    model: env.OPENAI_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI returned an empty response');
  }

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error('OpenAI did not return a valid JSON array');
  }

  const suggestions = JSON.parse(jsonMatch[0]) as FieldMappingSuggestion[];

  logger.info(
    { suggestionCount: suggestions.length, promptTokens: response.usage?.prompt_tokens },
    'AI field mapping completed',
  );

  return suggestions.filter((s) => BIR_TARGET_FIELDS.includes(s.targetField));
}

/**
 * Fuzzy field mapping using Levenshtein distance.
 * Used as fallback when OPENAI_API_KEY is not available.
 */
function fuzzyFieldMapping(sourceHeaders: string[]): FieldMappingSuggestion[] {
  const suggestions: FieldMappingSuggestion[] = [];

  // Common aliases including Tagalog terms
  const aliases: Record<string, string> = {
    qty: 'quantity',
    dami: 'quantity',
    desc: 'description',
    paglalarawan: 'description',
    amt: 'amount',
    halaga: 'amount',
    price: 'unitPriceCentavos',
    presyo: 'unitPriceCentavos',
    unit: 'unit',
    yunit: 'unit',
    date: 'invoiceDate',
    petsa: 'invoiceDate',
    tin: 'buyerTin',
    buyer: 'buyerName',
    mamimili: 'buyerName',
    type: 'invoiceType',
    uri: 'invoiceType',
    discount: 'discountCentavos',
    bawas: 'discountCentavos',
    vat: 'vatType',
    remarks: 'remarks',
    notes: 'remarks',
  };

  for (const header of sourceHeaders) {
    const normalized = header.toLowerCase().replace(/[\s_-]+/g, '');

    // Check aliases first
    const aliasMatch = aliases[normalized];
    if (aliasMatch) {
      suggestions.push({ sourceField: header, targetField: aliasMatch, confidence: 0.85 });
      continue;
    }

    // Find best Levenshtein match among BIR target fields
    let bestField = '';
    let bestScore = Infinity;

    for (const target of BIR_TARGET_FIELDS) {
      const targetNorm = target.toLowerCase();
      const dist = distance(normalized, targetNorm);
      const score = dist / Math.max(normalized.length, targetNorm.length);
      if (score < bestScore) {
        bestScore = score;
        bestField = target;
      }
    }

    if (bestScore < 0.5) {
      suggestions.push({
        sourceField: header,
        targetField: bestField,
        confidence: Math.max(0.1, 1 - bestScore * 2),
      });
    }
  }

  return suggestions;
}

/**
 * Saves a confirmed field mapping as a reusable template.
 */
export async function saveMappingTemplate(
  tenantId: string,
  body: SaveMappingTemplateBody,
  prisma: PrismaClient,
) {
  return prisma.fieldMappingTemplate.create({
    data: {
      tenantId,
      name: body.name,
      sourceType: body.sourceType,
      mapping: body.mapping,
      isAiGenerated: body.isAiGenerated,
    },
  });
}

/**
 * Lists all saved mapping templates for a tenant.
 */
export async function listMappingTemplates(tenantId: string, prisma: PrismaClient) {
  return prisma.fieldMappingTemplate.findMany({
    where: { tenantId, deletedAt: null },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Deletes a mapping template by ID (soft delete).
 */
export async function deleteMappingTemplate(
  tenantId: string,
  templateId: string,
  prisma: PrismaClient,
) {
  const template = await prisma.fieldMappingTemplate.findFirst({
    where: { id: templateId, tenantId, deletedAt: null },
  });

  if (!template) throw Object.assign(new Error('Template not found'), { statusCode: 404 });

  await prisma.fieldMappingTemplate.update({
    where: { id: templateId },
    data: { deletedAt: new Date() },
  });
}
