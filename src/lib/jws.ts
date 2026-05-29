import { SignJWT, importPKCS8 } from 'jose';
import { GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { secretsManagerClient } from '../config/aws';
import { logger } from './logger';

interface JwsSigningResult {
  jws: string;
  keyId?: string;
}

/**
 * Retrieves a tenant's private key from AWS Secrets Manager.
 * Keys are NEVER logged — they are [REDACTED] by the pino logger config.
 * TODO: confirm with BIR — confirm whether key format is PKCS8 PEM or JWK
 */
async function loadPrivateKey(secretArn: string): Promise<string> {
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const response = await secretsManagerClient.send(command);

  if (!response.SecretString) {
    throw new Error(`Private key not found in Secrets Manager: ${secretArn}`);
  }

  return response.SecretString;
}

/**
 * Signs a BIR invoice payload using JWS with RS256 (RSASSA-PKCS1-v1_5 + SHA-256).
 * Implements BIR RR 11-2025 signing specification.
 * TODO: confirm with BIR — confirm alg, header claims, and payload canonicalization required
 *
 * @param payload - The canonical BIR invoice JSON object to sign
 * @param privateKeyArn - AWS Secrets Manager ARN for the tenant's private key
 * @param tenantTin - Tenant TIN used as the JWT subject claim
 * @returns Compact JWS serialization string
 */
export async function signInvoicePayload(
  payload: Record<string, unknown>,
  privateKeyArn: string,
  tenantTin: string,
): Promise<JwsSigningResult> {
  const privateKeyPem = await loadPrivateKey(privateKeyArn);

  let privateKey;
  try {
    privateKey = await importPKCS8(privateKeyPem, 'RS256');
  } catch (err) {
    logger.error({ err, tenantTin }, 'Failed to import tenant private key from PEM');
    throw new Error('Invalid private key format — expected PKCS8 PEM');
  }

  const jws = await new SignJWT(payload)
    .setProtectedHeader({
      alg: 'RS256',
      typ: 'JWT',
      // TODO: confirm with BIR — confirm if x5c (certificate chain) must be included
    })
    .setIssuedAt()
    .setIssuer(tenantTin)
    .setSubject(tenantTin)
    // TODO: confirm with BIR — confirm audience claim value
    .setAudience('bir.gov.ph')
    .sign(privateKey);

  logger.debug({ tenantTin }, 'Invoice payload signed successfully');

  return { jws };
}

/**
 * Signs arbitrary data for cases where a full JWT structure is not needed.
 * Used for signing canonical invoice hashes per BIR spec variant.
 * TODO: confirm with BIR — whether raw JWS detached payload mode is required
 */
export async function signRawPayload(
  data: string,
  privateKeyArn: string,
): Promise<string> {
  const privateKeyPem = await loadPrivateKey(privateKeyArn);
  const privateKey = await importPKCS8(privateKeyPem, 'RS256');

  const encoder = new TextEncoder();
  const jws = await new SignJWT({ data })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuedAt()
    .sign(privateKey);

  return jws;
}
