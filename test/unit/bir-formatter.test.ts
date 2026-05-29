import { describe, it, expect } from 'vitest';
import { formatToBirJson } from '../../src/lib/bir-formatter';
import { Invoice, InvoiceLineItem } from '@prisma/client';

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice & { lineItems: InvoiceLineItem[] } {
  return {
    id: 'inv-uuid-1',
    tenantId: 'tenant-uuid-1',
    invoiceNumber: 'SI-00000001',
    invoiceType: 'SI',
    invoiceDate: new Date('2025-01-15'),
    status: 'DRAFT',
    vatType: 'VATABLE',
    sellerTin: '123-456-789-00000',
    sellerName: 'Test Corp',
    sellerAddress: '123 Makati Ave, Makati City',
    buyerTin: '987-654-321-00000',
    buyerName: 'Buyer Inc',
    buyerAddress: '456 BGC, Taguig City',
    buyerEmail: null,
    subtotalCentavos: BigInt(10000),
    vatAmountCentavos: BigInt(1200),
    discountCentavos: BigInt(0),
    totalAmountCentavos: BigInt(11200),
    rawPayload: null,
    birJson: null,
    jwsToken: null,
    birIref: null,
    birResponse: null,
    birSubmittedAt: null,
    birAcceptedAt: null,
    cancelledAt: null,
    cancelReason: null,
    queuedAt: null,
    processedAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
    lineItems: [
      {
        id: 'li-uuid-1',
        invoiceId: 'inv-uuid-1',
        lineNumber: 1,
        itemCode: 'ITEM001',
        description: 'Professional Services',
        unit: 'HR',
        quantity: { toNumber: () => 10 } as unknown as import('@prisma/client').Prisma.Decimal,
        unitPriceCentavos: BigInt(1000),
        discountCentavos: BigInt(0),
        vatRateBps: 1200,
        vatAmountCentavos: BigInt(1200),
        totalAmountCentavos: BigInt(11200),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  };
}

describe('bir-formatter', () => {
  it('formats a valid Sales Invoice', () => {
    const invoice = makeInvoice();
    const result = formatToBirJson(invoice);

    expect(result.invoiceType).toBe('SI');
    expect(result.invoiceNumber).toBe('SI-00000001');
    expect(result.invoiceDate).toBe('2025-01-15');
    expect(result.seller.tin).toBe('123-456-789-00000');
    expect(result.buyer.tin).toBe('987-654-321-00000');
    expect(result.lineItems).toHaveLength(1);
    expect(result.currency).toBe('PHP');
  });

  it('throws when invoiceNumber is missing', () => {
    const invoice = makeInvoice({ invoiceNumber: '' });
    expect(() => formatToBirJson(invoice)).toThrow('invoiceNumber is required');
  });

  it('throws when sellerTin is missing', () => {
    const invoice = makeInvoice({ sellerTin: '' });
    expect(() => formatToBirJson(invoice)).toThrow('sellerTin is required');
  });

  it('converts centavos to PHP correctly', () => {
    const invoice = makeInvoice({ totalAmountCentavos: BigInt(112_00) });
    const result = formatToBirJson(invoice);
    expect(result.totalAmount).toBe(112);
  });

  it('formats Credit Note with reference invoice', () => {
    const invoice = makeInvoice({
      invoiceType: 'CN',
      rawPayload: {
        referenceInvoiceNumber: 'SI-00000001',
        referenceInvoiceDate: '2025-01-10',
      },
    });
    const result = formatToBirJson(invoice);
    expect(result.referenceInvoiceNumber).toBe('SI-00000001');
  });
});
