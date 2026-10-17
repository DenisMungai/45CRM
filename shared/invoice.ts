/**
 * Shared invoice model for the 45Creatives invoice template.
 *
 * The server (public link, PDF) and the client (in-app sheet) all render from the same
 * `InvoiceView`, which is produced by `buildInvoiceView`, so what you see in the CRM is exactly
 * what the client receives. There is intentionally no KRA PIN and no tax/VAT handling here.
 */

export type InvoiceLineItem = { description: string; quantity: number; unitPrice: number };

export type InvoiceFields = {
  businessWebsite: string;
  // Bill to
  clientName: string;
  contactPerson: string;
  clientEmail: string;
  clientPhone: string;
  billingAddress: string;
  // Project details
  projectName: string;
  scope: string;
  quotationRef: string;
  paymentTerms: string;
  milestone: string;
  // Itemized services
  items: InvoiceLineItem[];
  discount: number;
  // Payment instructions
  mpesaNumber: string;
  mpesaAccount: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  confirmationContact: string;
  notes: string;
};

export const defaultInvoiceFields: InvoiceFields = {
  businessWebsite: "45creative.co.ke",
  clientName: "",
  contactPerson: "",
  clientEmail: "",
  clientPhone: "",
  billingAddress: "",
  projectName: "",
  scope: "",
  quotationRef: "",
  paymentTerms: "50% deposit, balance before launch",
  milestone: "",
  items: [{ description: "Website design & UI/UX", quantity: 1, unitPrice: 0 }],
  discount: 0,
  mpesaNumber: "",
  mpesaAccount: "",
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  confirmationContact: "",
  notes: "",
};

/** The payment-instruction fields that stay the same from one invoice to the next. */
export const paymentInstructionKeys = [
  "mpesaNumber", "mpesaAccount", "bankName", "bankAccountName", "bankAccountNumber", "confirmationContact", "businessWebsite",
] as const satisfies readonly (keyof InvoiceFields)[];

export type InvoiceDisplayStatus = "DRAFT" | "UNPAID" | "PART-PAID" | "PAID" | "OVERDUE" | "VOID";

export const INVOICE_TAGLINE = "WEB DESIGN \u00B7 DEVELOPMENT \u00B7 DIGITAL";

/** Standard terms from the template, without the tax / eTIMS note. */
export const INVOICE_TERMS = [
  "Work covered by this invoice follows the approved proposal or agreement. Unless otherwise agreed in writing, a 50% deposit is required before work begins and the remaining balance is payable before website launch or handover.",
  "Third-party fees (domain, hosting, paid plugins, stock assets, payment gateway charges) are included only where listed above.",
];

export function formatInvoiceMoney(value: number): string {
  return `KSh ${(Number.isFinite(value) ? value : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "16 Oct 2026", always in Nairobi time so the server, browser and PDF agree. */
export function formatInvoiceDate(value: Date | string | null | undefined): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
}

export function computeInvoiceTotals(items: InvoiceLineItem[], discount: number, received = 0) {
  const lines = items.map((item) => Math.round((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)));
  const subtotal = lines.reduce((sum, line) => sum + line, 0);
  const appliedDiscount = Math.min(Math.max(0, Math.round(Number(discount) || 0)), subtotal);
  const total = subtotal - appliedDiscount;
  const receivedAmount = Math.max(0, Math.round(Number(received) || 0));
  return { lines, subtotal, discount: appliedDiscount, total, received: receivedAmount, balance: Math.max(0, total - receivedAmount) };
}

export function deriveInvoiceStatus(input: { storedStatus: string; total: number; received: number; dueDate: Date | string | null; sent: boolean; now?: Date }): InvoiceDisplayStatus {
  const stored = (input.storedStatus || "").toLowerCase();
  if (stored === "void") return "VOID";
  const balance = Math.max(0, input.total - input.received);
  if (stored === "paid" || (input.total > 0 && balance <= 0)) return "PAID";
  const due = input.dueDate ? new Date(input.dueDate) : null;
  const now = input.now ?? new Date();
  // Due dates are day-granular, so an invoice only becomes overdue once its due day has passed.
  const pastDue = Boolean(due && !Number.isNaN(due.getTime()) && now.getTime() > due.getTime() + 86_400_000);
  if (stored === "overdue" || pastDue) return "OVERDUE";
  if (input.received > 0 || stored === "partial") return "PART-PAID";
  if (stored === "draft" && !input.sent) return "DRAFT";
  return "UNPAID";
}

export type InvoiceBusiness = { name: string; address: string; email: string; phone: string };

export type InvoiceView = {
  number: string;
  status: InvoiceDisplayStatus;
  issueDate: string;
  dueDate: string;
  business: InvoiceBusiness & { website: string };
  billTo: { client: string; contact: string; email: string; phone: string; address: string };
  project: { name: string; scope: string; quotationRef: string; paymentTerms: string; milestone: string };
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
  totals: { subtotal: number; discount: number; total: number; received: number; balance: number };
  payment: { mpesaNumber: string; mpesaAccount: string; bankName: string; bankAccountName: string; bankAccountNumber: string; reference: string; confirmationContact: string };
  paymentRecord: { date: string; method: string; reference: string; amount: number; count: number } | null;
  notes: string;
  terms: string[];
};

export type InvoicePaymentInput = { paidAt: Date | string; method: string | null; number: string; amount: number };

export function buildInvoiceView(input: {
  number: string;
  storedStatus: string;
  issueDate: Date | string | null;
  dueDate: Date | string | null;
  sent: boolean;
  business: InvoiceBusiness;
  fields: InvoiceFields;
  /** Completed payments recorded against this invoice. */
  payments: InvoicePaymentInput[];
  now?: Date;
}): InvoiceView {
  const { fields } = input;
  const paymentsSum = input.payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const preliminary = computeInvoiceTotals(fields.items, fields.discount, paymentsSum);
  // An invoice marked Paid by hand, with no payment rows, still shows as fully settled.
  const received = (input.storedStatus || "").toLowerCase() === "paid" ? Math.max(paymentsSum, preliminary.total) : paymentsSum;
  const totals = computeInvoiceTotals(fields.items, fields.discount, received);
  const status = deriveInvoiceStatus({ storedStatus: input.storedStatus, total: totals.total, received: totals.received, dueDate: input.dueDate, sent: input.sent, now: input.now });
  const latest = [...input.payments].sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())[0];
  return {
    number: input.number,
    status,
    issueDate: formatInvoiceDate(input.issueDate),
    dueDate: formatInvoiceDate(input.dueDate),
    business: { ...input.business, website: fields.businessWebsite },
    billTo: { client: fields.clientName, contact: fields.contactPerson, email: fields.clientEmail, phone: fields.clientPhone, address: fields.billingAddress },
    project: { name: fields.projectName, scope: fields.scope, quotationRef: fields.quotationRef, paymentTerms: fields.paymentTerms, milestone: fields.milestone },
    items: fields.items.map((item, index) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, amount: totals.lines[index] })),
    totals: { subtotal: totals.subtotal, discount: totals.discount, total: totals.total, received: totals.received, balance: totals.balance },
    payment: {
      mpesaNumber: fields.mpesaNumber,
      mpesaAccount: fields.mpesaAccount || input.number,
      bankName: fields.bankName,
      bankAccountName: fields.bankAccountName,
      bankAccountNumber: fields.bankAccountNumber,
      reference: input.number,
      confirmationContact: fields.confirmationContact || input.business.phone || input.business.email,
    },
    paymentRecord: latest ? { date: formatInvoiceDate(latest.paidAt), method: latest.method || "-", reference: latest.number, amount: latest.amount, count: input.payments.length } : null,
    notes: fields.notes,
    terms: INVOICE_TERMS,
  };
}
