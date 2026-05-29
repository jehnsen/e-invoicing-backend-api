import { Invoice, InvoiceLineItem, Prisma } from '@prisma/client';
import { CreateInvoiceBody } from './invoices.schema';

type InvoiceWithLineItems = Invoice & { lineItems: InvoiceLineItem[] };

/**
 * Computes VAT amount and total for a line item.
 * All amounts are stored as integer centavos.
 */
function computeLineItemAmounts(item: CreateInvoiceBody['lineItems'][0]) {
  const grossCentavos = BigInt(item.unitPriceCentavos) * BigInt(Math.round(item.quantity * 1_000_000));
  const grossRounded = grossCentavos / BigInt(1_000_000);
  const discountCentavos = BigInt(item.discountCentavos ?? 0);
  const netCentavos = grossRounded - discountCentavos;

  let vatAmountCentavos = BigInt(0);
  if (item.vatRateBps === 1200) {
    // VAT is computed on net amount: net / 1.12 * 0.12 = net * 12/112
    vatAmountCentavos = (netCentavos * BigInt(12)) / BigInt(112);
  }

  const totalAmountCentavos = netCentavos;

  return {
    vatAmountCentavos,
    totalAmountCentavos,
    discountCentavos,
  };
}

/**
 * Transforms an API CreateInvoiceBody into Prisma create data.
 * Computes all derived monetary fields (VAT, totals) in centavos.
 */
export function buildInvoiceCreateData(
  body: CreateInvoiceBody,
  tenantId: string,
  sellerTin: string,
  sellerName: string,
  sellerAddress: string,
  invoiceNumber: string,
): Prisma.InvoiceCreateInput {
  let subtotalCentavos = BigInt(0);
  let vatAmountCentavos = BigInt(0);
  let discountCentavos = BigInt(0);
  let totalAmountCentavos = BigInt(0);

  const lineItemsData = body.lineItems.map((item) => {
    const amounts = computeLineItemAmounts(item);
    subtotalCentavos += BigInt(item.unitPriceCentavos) * BigInt(Math.round(item.quantity));
    vatAmountCentavos += amounts.vatAmountCentavos;
    discountCentavos += amounts.discountCentavos;
    totalAmountCentavos += amounts.totalAmountCentavos;

    return {
      lineNumber: item.lineNumber,
      itemCode: item.itemCode,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      unitPriceCentavos: BigInt(item.unitPriceCentavos),
      discountCentavos: amounts.discountCentavos,
      vatRateBps: item.vatRateBps ?? 1200,
      vatAmountCentavos: amounts.vatAmountCentavos,
      totalAmountCentavos: amounts.totalAmountCentavos,
    };
  });

  const rawPayload = {
    ...body.rawPayload,
    referenceInvoiceNumber: body.referenceInvoiceNumber,
    referenceInvoiceDate: body.referenceInvoiceDate,
  };

  return {
    tenant: { connect: { id: tenantId } },
    invoiceNumber,
    invoiceType: body.invoiceType,
    invoiceDate: new Date(body.invoiceDate),
    vatType: body.vatType,
    sellerTin,
    sellerName,
    sellerAddress,
    buyerTin: body.buyerTin,
    buyerName: body.buyerName,
    buyerAddress: body.buyerAddress,
    buyerEmail: body.buyerEmail,
    subtotalCentavos,
    vatAmountCentavos,
    discountCentavos,
    totalAmountCentavos,
    rawPayload,
    lineItems: { create: lineItemsData },
  };
}

/**
 * Serializes an Invoice for API response — converts centavos to PHP decimal strings.
 */
export function serializeInvoice(invoice: InvoiceWithLineItems) {
  return {
    id: invoice.id,
    tenantId: invoice.tenantId,
    invoiceNumber: invoice.invoiceNumber,
    invoiceType: invoice.invoiceType,
    invoiceDate: invoice.invoiceDate.toISOString().split('T')[0],
    status: invoice.status,
    vatType: invoice.vatType,
    sellerTin: invoice.sellerTin,
    sellerName: invoice.sellerName,
    sellerAddress: invoice.sellerAddress,
    buyerTin: invoice.buyerTin,
    buyerName: invoice.buyerName,
    buyerAddress: invoice.buyerAddress,
    buyerEmail: invoice.buyerEmail,
    subtotalPhp: centavosToPhpString(invoice.subtotalCentavos),
    vatAmountPhp: centavosToPhpString(invoice.vatAmountCentavos),
    discountPhp: centavosToPhpString(invoice.discountCentavos),
    totalAmountPhp: centavosToPhpString(invoice.totalAmountCentavos),
    birIref: invoice.birIref,
    birSubmittedAt: invoice.birSubmittedAt,
    birAcceptedAt: invoice.birAcceptedAt,
    cancelledAt: invoice.cancelledAt,
    cancelReason: invoice.cancelReason,
    createdAt: invoice.createdAt,
    updatedAt: invoice.updatedAt,
    lineItems: invoice.lineItems.map((item) => ({
      id: item.id,
      lineNumber: item.lineNumber,
      itemCode: item.itemCode,
      description: item.description,
      unit: item.unit,
      quantity: Number(item.quantity),
      unitPricePhp: centavosToPhpString(item.unitPriceCentavos),
      discountPhp: centavosToPhpString(item.discountCentavos),
      vatRatePct: item.vatRateBps / 100,
      vatAmountPhp: centavosToPhpString(item.vatAmountCentavos),
      totalAmountPhp: centavosToPhpString(item.totalAmountCentavos),
    })),
  };
}

function centavosToPhpString(centavos: bigint): string {
  const abs = centavos < BigInt(0) ? -centavos : centavos;
  const sign = centavos < BigInt(0) ? '-' : '';
  const pesos = abs / BigInt(100);
  const cents = abs % BigInt(100);
  return `${sign}${pesos}.${cents.toString().padStart(2, '0')}`;
}
