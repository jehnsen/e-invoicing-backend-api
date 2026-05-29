import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { logger } from './logger';
import {
  BirSubmissionRequest,
  BirSubmissionResponse,
  BirStatusResponse,
  BirCancellationRequest,
  BirCancellationResponse,
} from '../types/bir.types';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

// TODO: confirm with BIR — auth method: Bearer token vs. mutual TLS (mTLS)
// Currently implementing Bearer token; mTLS support is stubbed below

interface BirClientOptions {
  baseUrl?: string;
  apiKey?: string;
  tenantId: string;
  invoiceId?: string;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Makes an authenticated HTTP request to the BIR EIS API with retry logic.
 * Logs every request and response to the Transmission table.
 * TODO: confirm with BIR — final endpoint paths and response envelope format
 */
async function birRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  body: unknown,
  options: BirClientOptions,
  prisma: PrismaClient,
): Promise<T> {
  const baseUrl = options.baseUrl ?? env.BIR_API_BASE_URL;
  const url = `${baseUrl}${path}`;
  const startedAt = Date.now();

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let statusCode: number | undefined;
    let responseBody: unknown;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          // TODO: confirm with BIR — exact Authorization header format
          Authorization: `Bearer ${options.apiKey ?? env.BIR_API_KEY}`,
          'X-BIR-Client-Id': 'EIS-Ready',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      statusCode = response.status;
      const duration = Date.now() - startedAt;

      try {
        responseBody = await response.json();
      } catch {
        responseBody = await response.text();
      }

      if (options.invoiceId) {
        await prisma.transmission.create({
          data: {
            invoiceId: options.invoiceId,
            tenantId: options.tenantId,
            attemptNumber: attempt,
            statusCode,
            requestBody: body as object,
            responseBody: responseBody as object,
            durationMs: duration,
            success: response.ok,
          },
        });
      }

      if (response.ok) {
        logger.info({ url, method, statusCode, attempt }, 'BIR API request succeeded');
        return responseBody as T;
      }

      logger.warn({ url, method, statusCode, attempt, responseBody }, 'BIR API returned error');

      // 429 Too Many Requests — respect rate limit before retry
      if (statusCode === 429) {
        const retryAfterMs = 60_000;
        logger.warn({ retryAfterMs }, 'BIR API rate limited — waiting before retry');
        await sleep(retryAfterMs);
      } else if (statusCode >= 400 && statusCode < 500) {
        // 4xx are client errors — do not retry
        throw new Error(`BIR API client error ${statusCode}: ${JSON.stringify(responseBody)}`);
      }

      lastError = new Error(`BIR API error ${statusCode}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (options.invoiceId) {
        await prisma.transmission.create({
          data: {
            invoiceId: options.invoiceId,
            tenantId: options.tenantId,
            attemptNumber: attempt,
            statusCode,
            requestBody: body as object,
            errorMessage: lastError.message,
            durationMs: Date.now() - startedAt,
            success: false,
          },
        });
      }

      if (attempt < MAX_RETRIES) {
        const backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.warn({ err: lastError, attempt, backoffMs }, 'BIR API request failed — retrying');
        await sleep(backoffMs);
      }
    }
  }

  throw lastError ?? new Error('BIR API request failed after maximum retries');
}

/**
 * Submits a signed invoice to the BIR EIS API.
 * TODO: confirm with BIR — POST endpoint path: /v1/invoices or /api/invoice/submit
 */
export async function submitInvoice(
  request: BirSubmissionRequest,
  options: BirClientOptions,
  prisma: PrismaClient,
): Promise<BirSubmissionResponse> {
  return birRequest<BirSubmissionResponse>(
    'POST',
    // TODO: confirm with BIR — exact submission endpoint path
    '/v1/invoices',
    request,
    options,
    prisma,
  );
}

/**
 * Retrieves the status of a previously submitted invoice by BIR IREF.
 * TODO: confirm with BIR — GET endpoint path and iref query param name
 */
export async function getInvoiceStatus(
  iref: string,
  options: BirClientOptions,
  prisma: PrismaClient,
): Promise<BirStatusResponse> {
  return birRequest<BirStatusResponse>(
    'GET',
    `/v1/invoices/${encodeURIComponent(iref)}/status`,
    null,
    options,
    prisma,
  );
}

/**
 * Cancels a previously accepted invoice via the BIR EIS API.
 * TODO: confirm with BIR — cancellation endpoint and whether it's a POST or DELETE
 */
export async function cancelInvoice(
  request: BirCancellationRequest,
  options: BirClientOptions,
  prisma: PrismaClient,
): Promise<BirCancellationResponse> {
  return birRequest<BirCancellationResponse>(
    'POST',
    `/v1/invoices/${encodeURIComponent(request.iref)}/cancel`,
    { reason: request.reason },
    options,
    prisma,
  );
}

/**
 * Pings the BIR EIS API health endpoint to verify connectivity.
 * Used by the /healthz route.
 * TODO: confirm with BIR — health check endpoint path
 */
export async function pingBirApi(): Promise<{ reachable: boolean; latencyMs?: number }> {
  const url = `${env.BIR_API_BASE_URL}/health`;
  const start = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    return { reachable: response.ok, latencyMs: Date.now() - start };
  } catch {
    return { reachable: false };
  }
}
