import { Invoice, InvoiceLineItem } from '@prisma/client';
import { BirInvoicePayload, BirLineItem, BirInvoiceType, BirVatType } from '../types/bir.types';

const BIR_SCHEMA_VERSION = '1.0';
// TODO: confirm with BIR — schema version string when official spec is released

type InvoiceWithLineItems = Invoice & { lineItems: InvoiceLineItem[] };

/**
 * Converts centavo integer to PHP decimal string with 2 decimal places.
 * All money in DB is stored as integer centavos — never float.
 */
function centavosToPhp(centavos: bigint): number {
  return Number(centavos) / 100;
}

function centavosToPhpLineItem(centavos: bigint): number {
  return Number(centavos) / 100;
}

/**
 * Transforms an internal Invoice DB record into the BIR EIS JSON schema format.
 * Handles all Philippine invoice types per TRAIN Act:
 *   SI (Sales Invoice), OR (Official Receipt), DI (Delivery Invoice),
 *   CN (Credit Note), DN (Debit Note)
 *
 * @throws Error if required BIR fields are missing
 */
export function formatToBirJson(invoice: InvoiceWithLineItems): BirInvoicePayload {
  validateRequiredFields(invoice);

  const birLineItems: BirLineItem[] = invoice.lineItems.map((item) => ({
    lineNumber: item.lineNumber,
    itemCode: item.itemCode ?? undefined,
    description: item.description,
    unit: item.unit,
    quantity: Number(item.quantity),
    unitPrice: centavosToPhpLineItem(item.unitPriceCentavos),
    discount: centavosToPhpLineItem(item.discountCentavos),
    vatRate: item.vatRateBps / 10000,
    vatAmount: centavosToPhpLineItem(item.vatAmountCentavos),
    totalAmount: centavosToPhpLineItem(item.totalAmountCentavos),
  }));

  const vatBreakdown = computeVatBreakdown(invoice.lineItems, invoice.vatType as string);

  const payload: BirInvoicePayload = {
    schemaVersion: BIR_SCHEMA_VERSION,
    invoiceType: invoice.invoiceType as BirInvoiceType,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: invoice.invoiceDate.toISOString().split('T')[0],
    seller: {
      tin: invoice.sellerTin,
      registeredName: invoice.sellerName,
      address: invoice.sellerAddress,
    },
    buyer: {
      tin: invoice.buyerTin ?? undefined,
      registeredName: invoice.buyerName,
      address: invoice.buyerAddress ?? undefined,
      email: invoice.buyerEmail ?? undefined,
    },
    lineItems: birLineItems,
    vatableSales: vatBreakdown.vatableSales,
    zeroRatedSales: vatBreakdown.zeroRatedSales,
    exemptSales: vatBreakdown.exemptSales,
    totalVat: centavosToPhp(invoice.vatAmountCentavos),
    totalDiscount: centavosToPhp(invoice.discountCentavos),
    totalAmount: centavosToPhp(invoice.totalAmountCentavos),
    currency: 'PHP',
    vatType: invoice.vatType as BirVatType,
    remarks: undefined,
  };

  // For Credit Notes and Debit Notes, reference invoice must be set
  if (invoice.invoiceType === 'CN' || invoice.invoiceType === 'DN') {
    // TODO: confirm with BIR — referenceInvoiceNumber field name in CN/DN schema
    payload.referenceInvoiceNumber = (invoice.rawPayload as Record<string, unknown>)
      ?.referenceInvoiceNumber as string | undefined;
    payload.referenceInvoiceDate = (invoice.rawPayload as Record<string, unknown>)
      ?.referenceInvoiceDate as string | undefined;
  }

  return payload;
}

interface VatBreakdown {
  vatableSales: number;
  zeroRatedSales: number;
  exemptSales: number;
}

/**
 * Computes VAT breakdown per line item classification.
 * Philippine TRAIN Act requires separate reporting of vatable, zero-rated, and exempt sales.
 */
function computeVatBreakdown(lineItems: InvoiceLineItem[], vatType: string): VatBreakdown {
  let vatableSalesCentavos = BigInt(0);
  let zeroRatedSalesCentavos = BigInt(0);
  let exemptSalesCentavos = BigInt(0);

  for (const item of lineItems) {
    const net = item.totalAmountCentavos - item.vatAmountCentavos;

    if (item.vatRateBps === 1200) {
      vatableSalesCentavos += net;
    } else if (item.vatRateBps === 0 && vatType === 'ZERO_RATED') {
      zeroRatedSalesCentavos += net;
    } else if (item.vatRateBps === 0) {
      exemptSalesCentavos += net;
    }
  }

  return {
    vatableSales: centavosToPhp(vatableSalesCentavos),
    zeroRatedSales: centavosToPhp(zeroRatedSalesCentavos),
    exemptSales: centavosToPhp(exemptSalesCentavos),
  };
}

function validateRequiredFields(invoice: InvoiceWithLineItems): void {
  const errors: string[] = [];

  if (!invoice.invoiceNumber) errors.push('invoiceNumber is required');
  if (!invoice.invoiceType) errors.push('invoiceType is required');
  if (!invoice.invoiceDate) errors.push('invoiceDate is required');
  if (!invoice.sellerTin) errors.push('sellerTin is required');
  if (!invoice.sellerName) errors.push('sellerName is required');
  if (!invoice.sellerAddress) errors.push('sellerAddress is required');
  if (!invoice.buyerName) errors.push('buyerName is required');
  if (!invoice.lineItems || invoice.lineItems.length === 0) {
    errors.push('at least one line item is required');
  }

  for (const item of invoice.lineItems) {
    if (!item.description) errors.push(`lineItem ${item.lineNumber}: description is required`);
    if (!item.unit) errors.push(`lineItem ${item.lineNumber}: unit is required`);
    if (item.quantity === null) errors.push(`lineItem ${item.lineNumber}: quantity is required`);
  }

  if (errors.length > 0) {
    throw new Error(`BIR formatter validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
}
