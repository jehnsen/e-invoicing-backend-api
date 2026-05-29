import { describe, it, expect } from 'vitest';
import { validateBirPayload, isValidPhTin } from '../../src/lib/validator';
import { BirInvoicePayload } from '../../src/types/bir.types';

function makePayload(overrides: Partial<BirInvoicePayload> = {}): BirInvoicePayload {
  return {
    schemaVersion: '1.0',
    invoiceType: 'SI',
    invoiceNumber: 'SI-00000001',
    invoiceDate: '2025-01-15',
    seller: {
      tin: '123-456-789-00000',
      registeredName: 'Test Corp',
      address: '123 Makati Ave',
    },
    buyer: {
      registeredName: 'Buyer Inc',
    },
    lineItems: [
      {
        lineNumber: 1,
        description: 'Service',
        unit: 'HR',
        quantity: 1,
        unitPrice: 100,
        discount: 0,
        vatRate: 0.12,
        vatAmount: 12,
        totalAmount: 112,
      },
    ],
    vatableSales: 100,
    zeroRatedSales: 0,
    exemptSales: 0,
    totalVat: 12,
    totalDiscount: 0,
    totalAmount: 112,
    currency: 'PHP',
    vatType: 'VATABLE',
    ...overrides,
  };
}

describe('validator', () => {
  it('validates a correct payload', () => {
    const result = validateBirPayload(makePayload());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing invoiceNumber', () => {
    const result = validateBirPayload(makePayload({ invoiceNumber: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('invoiceNumber'))).toBe(true);
  });

  it('rejects invalid invoiceType', () => {
    const result = validateBirPayload(makePayload({ invoiceType: 'XX' as 'SI' }));
    expect(result.valid).toBe(false);
  });

  it('rejects invalid invoiceDate format', () => {
    const result = validateBirPayload(makePayload({ invoiceDate: '01/15/2025' }));
    expect(result.valid).toBe(false);
  });

  it('rejects non-PHP currency', () => {
    const result = validateBirPayload(makePayload({ currency: 'USD' }));
    expect(result.valid).toBe(false);
  });

  it('rejects CN without referenceInvoiceNumber', () => {
    const result = validateBirPayload(makePayload({ invoiceType: 'CN' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('referenceInvoiceNumber'))).toBe(true);
  });

  it('validates empty line items', () => {
    const result = validateBirPayload(makePayload({ lineItems: [] }));
    expect(result.valid).toBe(false);
  });
});

describe('isValidPhTin', () => {
  it('accepts valid TIN format', () => {
    expect(isValidPhTin('123-456-789-00000')).toBe(true);
    expect(isValidPhTin('123-456-789-000')).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(isValidPhTin('12345678900')).toBe(false);
    expect(isValidPhTin('123-456-789')).toBe(false);
    expect(isValidPhTin('')).toBe(false);
  });
});
