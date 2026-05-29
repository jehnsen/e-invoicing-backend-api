import { BirInvoicePayload } from '../types/bir.types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const PH_TIN_PATTERN = /^\d{3}-\d{3}-\d{3}-\d{3,5}$/;
// TODO: confirm with BIR — official TIN format with branch code (NNN-NNN-NNN-NNNVV)

/**
 * Validates a BIR invoice payload against field rules prior to transmission.
 * Ensures compliance with BIR EIS requirements per RR 11-2025.
 */
export function validateBirPayload(payload: BirInvoicePayload): ValidationResult {
  const errors: string[] = [];

  if (!payload.invoiceNumber || payload.invoiceNumber.trim().length === 0) {
    errors.push('invoiceNumber must not be empty');
  }

  if (!['SI', 'OR', 'DI', 'CN', 'DN'].includes(payload.invoiceType)) {
    errors.push(`invoiceType must be SI, OR, DI, CN, or DN — got: ${payload.invoiceType}`);
  }

  if (!payload.invoiceDate || !/^\d{4}-\d{2}-\d{2}$/.test(payload.invoiceDate)) {
    errors.push('invoiceDate must be in YYYY-MM-DD format');
  }

  if (!payload.seller?.tin) {
    errors.push('seller.tin is required');
  } else if (!PH_TIN_PATTERN.test(payload.seller.tin)) {
    // TODO: confirm with BIR — exact TIN format validation rule
    errors.push(`seller.tin format invalid: ${payload.seller.tin}`);
  }

  if (!payload.seller?.registeredName) {
    errors.push('seller.registeredName is required');
  }

  if (!payload.seller?.address) {
    errors.push('seller.address is required');
  }

  if (!payload.buyer?.registeredName) {
    errors.push('buyer.registeredName is required');
  }

  if (!payload.lineItems || payload.lineItems.length === 0) {
    errors.push('at least one lineItem is required');
  }

  for (const item of payload.lineItems ?? []) {
    if (item.quantity <= 0) {
      errors.push(`lineItem ${item.lineNumber}: quantity must be greater than 0`);
    }
    if (item.unitPrice < 0) {
      errors.push(`lineItem ${item.lineNumber}: unitPrice must be >= 0`);
    }
    if (item.vatRate !== 0 && item.vatRate !== 0.12) {
      // TODO: confirm with BIR — whether other VAT rates (e.g. 0.05 for GCash) apply
      errors.push(`lineItem ${item.lineNumber}: vatRate must be 0 or 0.12`);
    }
    if (!item.description) {
      errors.push(`lineItem ${item.lineNumber}: description is required`);
    }
  }

  if (payload.totalAmount < 0) {
    errors.push('totalAmount must not be negative');
  }

  if (payload.totalVat < 0) {
    errors.push('totalVat must not be negative');
  }

  if (payload.currency !== 'PHP') {
    // TODO: confirm with BIR — whether foreign currency invoices are supported
    errors.push(`currency must be PHP — got: ${payload.currency}`);
  }

  // CN/DN must reference an original invoice
  if ((payload.invoiceType === 'CN' || payload.invoiceType === 'DN') && !payload.referenceInvoiceNumber) {
    errors.push(`${payload.invoiceType} must include referenceInvoiceNumber`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validates Philippine TIN format.
 * Format: NNN-NNN-NNN-NNNVV where VV is the 2-digit branch code.
 */
export function isValidPhTin(tin: string): boolean {
  return PH_TIN_PATTERN.test(tin);
}

/**
 * Validates that a monetary amount is non-negative and has at most 2 decimal places.
 */
export function isValidMonetaryAmount(amount: number): boolean {
  if (amount < 0) return false;
  const str = amount.toString();
  const decimal = str.indexOf('.');
  if (decimal === -1) return true;
  return str.length - decimal - 1 <= 2;
}
