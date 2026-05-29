/**
 * BIR EIS (Electronic Invoicing System) type definitions.
 * Based on BIR Revenue Regulations 11-2025.
 * TODO: confirm with BIR — JSON schema version may change upon official release
 */

export type BirInvoiceType = 'SI' | 'OR' | 'DI' | 'CN' | 'DN';

export type BirVatType = 'VATABLE' | 'ZERO_RATED' | 'EXEMPT' | 'MIXED';

export interface BirLineItem {
  lineNumber: number;
  itemCode?: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice: number;        // in PHP, 2 decimal places
  discount: number;         // in PHP
  vatRate: number;          // 0.12 | 0.00
  vatAmount: number;        // in PHP
  totalAmount: number;      // in PHP
}

export interface BirSellerInfo {
  tin: string;              // format: NNN-NNN-NNN-NNNVV (TIN + branch code)
  registeredName: string;
  tradeName?: string;
  address: string;
  contactNumber?: string;
}

export interface BirBuyerInfo {
  tin?: string;
  registeredName: string;
  address?: string;
  email?: string;
}

export interface BirInvoicePayload {
  // TODO: confirm with BIR — exact field names may differ in final EIS spec
  schemaVersion: string;         // e.g. "1.0"
  invoiceType: BirInvoiceType;
  invoiceNumber: string;
  invoiceDate: string;           // ISO 8601 date: YYYY-MM-DD
  seller: BirSellerInfo;
  buyer: BirBuyerInfo;
  lineItems: BirLineItem[];
  vatableSales: number;
  zeroRatedSales: number;
  exemptSales: number;
  totalVat: number;
  totalDiscount: number;
  totalAmount: number;
  currency: string;              // default: 'PHP'
  vatType: BirVatType;
  remarks?: string;

  // For Credit/Debit Notes
  referenceInvoiceNumber?: string;
  referenceInvoiceDate?: string;
}

export interface BirSubmissionRequest {
  invoice: BirInvoicePayload;
  jws: string;               // compact JWS serialization of signed invoice
}

export interface BirSubmissionResponse {
  // TODO: confirm with BIR — response schema not yet publicly documented
  iref: string;              // BIR-assigned Invoice Reference Number
  status: 'ACCEPTED' | 'REJECTED' | 'PENDING';
  message?: string;
  timestamp: string;
  errors?: BirValidationError[];
}

export interface BirValidationError {
  field: string;
  code: string;
  message: string;
}

export interface BirStatusResponse {
  iref: string;
  status: 'ACCEPTED' | 'REJECTED' | 'PENDING' | 'CANCELLED';
  message?: string;
  timestamp: string;
}

export interface BirCancellationRequest {
  iref: string;
  reason: string;
  // TODO: confirm with BIR — cancellation fields may vary
}

export interface BirCancellationResponse {
  iref: string;
  status: 'CANCELLED' | 'REJECTED';
  message?: string;
}

export interface BirJwsHeader {
  alg: 'RS256';
  typ: 'JWT';
  // TODO: confirm with BIR — confirm if x5c (cert chain) is required in header
  x5c?: string[];
}
