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
  // Send Money / Pochi la Biashara
  pochiNumber: string;
  pochiName: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  confirmationContact: string;
  notes: string;
  // Currency the document is issued in, and KES per one unit of it. Payments and the ledger are
  // always in KES; the rate converts them to the document's currency.
  currency: Currency;
  exchangeRate: number;
};

export const CURRENCIES = ["KES", "USD", "EUR", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];
/** Prefix shown before amounts. Codes rather than symbols: the PDF fonts can't draw every symbol. */
export function currencyPrefix(currency: string | null | undefined): string { return !currency || currency === "KES" ? "KSh" : currency; }
/** KES per unit for a document, never zero or negative. */
export function rateOf(fields: Pick<InvoiceFields, "currency" | "exchangeRate"> | null | undefined): number {
  if (!fields || !fields.currency || fields.currency === "KES") return 1;
  const rate = Number(fields.exchangeRate);
  return Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/** The template's payment terms, used when an invoice or quote has none of its own. */
export const STANDARD_PAYMENT_TERMS = "50% deposit before work begins; balance due before launch or handover.";

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
  paymentTerms: STANDARD_PAYMENT_TERMS,
  milestone: "",
  items: [
    { description: "Website design & UI/UX", quantity: 1, unitPrice: 0 },
    { description: "Website development", quantity: 1, unitPrice: 0 },
    { description: "Domain & hosting", quantity: 1, unitPrice: 0 },
  ],
  discount: 0,
  mpesaNumber: "",
  mpesaAccount: "",
  pochiNumber: "",
  pochiName: "",
  bankName: "",
  bankAccountName: "",
  bankAccountNumber: "",
  confirmationContact: "",
  notes: "",
  currency: "KES",
  exchangeRate: 1,
};

/** The payment-instruction fields that stay the same from one invoice to the next. */
export const paymentInstructionKeys = [
  "mpesaNumber", "mpesaAccount", "pochiNumber", "pochiName", "bankName", "bankAccountName", "bankAccountNumber", "confirmationContact", "businessWebsite",
] as const satisfies readonly (keyof InvoiceFields)[];

export const INVOICE_NUMBER_PREFIX = "45C-INV-";

/** The next number in the 45C-INV-0001 sequence, given the numbers already used. */
export function nextInvoiceNumberFrom(existing: string[]): string {
  const pattern = new RegExp(`^${INVOICE_NUMBER_PREFIX}(\\d+)$`);
  const highest = existing.reduce((max, number) => { const match = pattern.exec((number || "").trim()); return match ? Math.max(max, Number(match[1])) : max; }, 0);
  return `${INVOICE_NUMBER_PREFIX}${String(highest + 1).padStart(4, "0")}`;
}

export type InvoiceDisplayStatus = "DRAFT" | "UNPAID" | "PART-PAID" | "PAID" | "OVERDUE" | "VOID";

export const INVOICE_TAGLINE = "WEB DESIGN · DEVELOPMENT";

/** Ends a sentence with a full stop unless it already has closing punctuation. */
const sentence = (text: string) => { const t = text.trim(); return t && !/[.!?]$/.test(t) ? `${t}.` : t; };

/** The closing note under "How to pay" (invoices) or "Next steps" (quotes), one sentence per entry. */
export function documentTerms(kind: "invoice" | "quote", paymentTerms: string): string[] {
  const terms = sentence(paymentTerms || "") || STANDARD_PAYMENT_TERMS;
  return kind === "quote"
    ? ["Prices are valid until the date shown.", terms, "Changes outside the quoted scope are quoted separately."]
    : ["Please quote the invoice number when paying.", terms];
}

/**
 * KES received, expressed in the document's currency. A balance worth less than one shilling
 * (a rounding remainder after converting) counts as fully paid.
 */
export function receivedInDocCurrency(total: number, receivedKes: number, rate: number): number {
  const received = Math.round(((Number(receivedKes) || 0) / (rate > 0 ? rate : 1)) * 100) / 100;
  return total > 0 && (total - received) * rate < 1 && received > 0 ? Math.max(received, total) : received;
}

/** "1,234.00" - an amount without a currency prefix (table columns already name the currency). */
export function formatPlainAmount(value: number): string {
  return (Number.isFinite(value) ? value : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatInvoiceMoney(value: number, currency: string = "KES"): string {
  return `${currencyPrefix(currency)} ${formatPlainAmount(value)}`;
}

export type QuoteDisplayStatus = "DRAFT" | "SENT" | "ACCEPTED" | "DECLINED" | "EXPIRED";
export function deriveQuoteStatus(input: { decision: string | null | undefined; sent: boolean; validUntil: Date | string | null; now?: Date }): QuoteDisplayStatus {
  if (input.decision === "accepted") return "ACCEPTED";
  if (input.decision === "declined") return "DECLINED";
  const until = input.validUntil ? new Date(input.validUntil) : null;
  const now = input.now ?? new Date();
  if (until && !Number.isNaN(until.getTime()) && now.getTime() > until.getTime() + 86_400_000) return "EXPIRED";
  return input.sent ? "SENT" : "DRAFT";
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

/**
 * The status to store on the `invoices` row so the Invoices list matches the invoice itself.
 * Payments decide paid / partial; sending moves a draft to sent. A hand-set Paid with no payment
 * rows, Void and Overdue are left alone.
 */
export function nextStoredInvoiceStatus(input: { storedStatus: string; total: number; received: number; sent: boolean }): string {
  const stored = (input.storedStatus || "draft").toLowerCase();
  if (stored === "void") return stored;
  if (input.total > 0 && input.received >= input.total) return "paid";
  if (input.received > 0) return "partial";
  if (stored === "partial") return input.sent ? "sent" : "draft";
  if (stored === "draft" && input.sent) return "sent";
  return stored;
}

export type InvoiceBusiness = { name: string; address: string; email: string; phone: string };

export type InvoiceView = {
  kind: "invoice" | "quote";
  number: string;
  status: InvoiceDisplayStatus | QuoteDisplayStatus;
  currency: string;
  exchangeRate: number;
  issueDate: string;
  /** Due date for an invoice, "valid until" for a quote. */
  dueDate: string;
  decision: { by: string; at: string; note: string } | null;
  business: InvoiceBusiness & { website: string };
  billTo: { client: string; contact: string; email: string; phone: string; address: string };
  project: { name: string; scope: string; quotationRef: string; paymentTerms: string; milestone: string };
  items: { description: string; quantity: number; unitPrice: number; amount: number }[];
  totals: { subtotal: number; discount: number; total: number; received: number; balance: number };
  payment: { mpesaNumber: string; mpesaAccount: string; pochiNumber: string; pochiName: string; bankName: string; bankAccountName: string; bankAccountNumber: string; reference: string; confirmationContact: string };
  paymentRecord: { date: string; method: string; reference: string; amount: number; count: number } | null;
  /** Every completed payment, oldest first, in the document's currency. `reference` is the M-Pesa code for M-Pesa payments. */
  payments: { date: string; method: string; reference: string; amount: number }[];
  notes: string;
  terms: string[];
};

/** Lines without a unit price are left off the document, unless every line is unpriced. */
export function printableItems<T extends { unitPrice: number }>(items: T[]): T[] {
  const priced = items.filter((item) => Number(item.unitPrice) > 0);
  return priced.length ? priced : items;
}

/** A deposit already received, keyed in when the invoice is created. Amount is in KES, like every payment. */
export const DEPOSIT_METHODS = ["M-Pesa", "Bank", "Cash"] as const;
export type InvoiceDeposit = { amount: number; method: (typeof DEPOSIT_METHODS)[number]; reference: string; paidAt: Date | string };

export type InvoicePaymentInput = { paidAt: Date | string; method: string | null; number: string; amount: number };

export function buildInvoiceView(input: {
  number: string;
  storedStatus: string;
  issueDate: Date | string | null;
  dueDate: Date | string | null;
  sent: boolean;
  business: InvoiceBusiness;
  fields: InvoiceFields;
  /** Completed payments recorded against this invoice, in KES. */
  payments: InvoicePaymentInput[];
  now?: Date;
  kind?: "invoice" | "quote";
  /** Quotes: the client's decision, if any. */
  decision?: { decision: string | null; by: string | null; at: Date | string | null; note: string | null };
}): InvoiceView {
  const { fields } = input;
  const kind = input.kind ?? "invoice";
  const currency = fields.currency || "KES";
  const rate = rateOf(fields);
  // Payments are KES; express them in the document's currency.
  const toDoc = (kes: number) => Math.round(((Number(kes) || 0) / rate) * 100) / 100;
  const paymentsSum = receivedInDocCurrency(computeInvoiceTotals(fields.items, fields.discount).total, input.payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0), rate);
  const preliminary = computeInvoiceTotals(fields.items, fields.discount, paymentsSum);
  // An invoice marked Paid by hand, with no payment rows, still shows as fully settled.
  const received = (input.storedStatus || "").toLowerCase() === "paid" ? Math.max(paymentsSum, preliminary.total) : paymentsSum;
  const totals = computeInvoiceTotals(fields.items, fields.discount, received);
  const status = kind === "quote"
    ? deriveQuoteStatus({ decision: input.decision?.decision, sent: input.sent, validUntil: input.dueDate, now: input.now })
    : deriveInvoiceStatus({ storedStatus: input.storedStatus, total: totals.total, received: totals.received, dueDate: input.dueDate, sent: input.sent, now: input.now });
  const latest = [...input.payments].sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())[0];
  const decided = input.decision?.decision ? { by: input.decision.by || "", at: formatInvoiceDate(input.decision.at), note: input.decision.note || "" } : null;
  return {
    kind,
    number: input.number,
    status,
    currency,
    exchangeRate: rate,
    issueDate: formatInvoiceDate(input.issueDate),
    dueDate: formatInvoiceDate(input.dueDate),
    decision: decided,
    business: { ...input.business, website: fields.businessWebsite },
    billTo: { client: fields.clientName, contact: fields.contactPerson, email: fields.clientEmail, phone: fields.clientPhone, address: fields.billingAddress },
    project: { name: fields.projectName, scope: fields.scope, quotationRef: fields.quotationRef, paymentTerms: fields.paymentTerms, milestone: fields.milestone },
    items: printableItems(fields.items.map((item, index) => ({ description: item.description, quantity: item.quantity, unitPrice: item.unitPrice, amount: totals.lines[index] }))),
    totals: { subtotal: totals.subtotal, discount: totals.discount, total: totals.total, received: totals.received, balance: totals.balance },
    payment: {
      mpesaNumber: fields.mpesaNumber,
      mpesaAccount: fields.mpesaAccount || input.number,
      pochiNumber: fields.pochiNumber || "",
      pochiName: fields.pochiName || "",
      bankName: fields.bankName,
      bankAccountName: fields.bankAccountName,
      bankAccountNumber: fields.bankAccountNumber,
      reference: input.number,
      confirmationContact: fields.confirmationContact || input.business.phone || input.business.email,
    },
    payments: kind === "invoice"
      ? [...input.payments].sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime()).map((p) => ({ date: formatInvoiceDate(p.paidAt), method: p.method || "Payment", reference: p.number, amount: toDoc(p.amount) }))
      : [],
    paymentRecord: kind === "invoice" && latest ? { date: formatInvoiceDate(latest.paidAt), method: latest.method || "-", reference: latest.number, amount: toDoc(latest.amount), count: input.payments.length } : null,
    notes: fields.notes,
    terms: documentTerms(kind, fields.paymentTerms),
  };
}

/*
 * Layout helpers for the 45Creatives template. The in-app sheet and the PDF both build their
 * rows from these, so the wording, order and signs always match between the two.
 */

export type TemplateRow = { label: string; value: string };

/** "Invoice number / Date of issue / Date due" block under the title. */
export function templateMetaRows(view: InvoiceView): TemplateRow[] {
  const isQuote = view.kind === "quote";
  const notable = ["PAID", "VOID", "ACCEPTED", "DECLINED", "EXPIRED"].includes(view.status);
  return [
    { label: isQuote ? "Quotation number" : "Invoice number", value: view.number },
    { label: "Date of issue", value: view.issueDate },
    { label: isQuote ? "Valid until" : "Date due", value: view.dueDate },
    ...(view.currency !== "KES" ? [{ label: "Currency", value: view.currency }] : []),
    ...(notable ? [{ label: "Status", value: view.status.charAt(0) + view.status.slice(1).toLowerCase() }] : []),
  ];
}

/** The large line above the table: "KSh 0.00 due 30 Oct 2026". */
export function templateHeadline(view: InvoiceView): { amount: string; text: string } {
  return view.kind === "quote"
    ? { amount: formatInvoiceMoney(view.totals.total, view.currency), text: `valid until ${view.dueDate}` }
    : { amount: formatInvoiceMoney(view.totals.balance, view.currency), text: `due ${view.dueDate}` };
}

/** Optional project details shown in small type under "Project:". */
export function templateProjectDetails(view: InvoiceView): string[] {
  return [
    view.project.scope,
    view.project.quotationRef && `Ref ${view.project.quotationRef}`,
    view.project.milestone && `Milestone: ${view.project.milestone}`,
  ].filter((line): line is string => Boolean(line && line.trim()));
}

/** Totals under the table. The last row is the bold, ruled one ("Amount due" or the quote total). */
export function templateTotalRows(view: InvoiceView): TemplateRow[] {
  const money = (value: number) => formatInvoiceMoney(value, view.currency);
  const { totals } = view;
  const rows: TemplateRow[] = [
    { label: "Subtotal", value: money(totals.subtotal) },
    { label: "Discount", value: `\u2013 ${money(totals.discount)}` },
    { label: "Total", value: money(totals.total) },
  ];
  if (view.kind === "quote") return rows;
  const paidLabel = totals.received > 0 && totals.balance <= 0 ? "Paid" : (view.paymentRecord?.count ?? 0) > 1 ? "Payments received" : "Deposit paid";
  return [...rows, { label: paidLabel, value: `\u2013 ${money(totals.received)}` }, { label: "Amount due", value: money(totals.balance) }];
}

/** "How to pay" rows: M-Pesa paybill/till, Send Money / Pochi, and bank. Empty methods are left out. */
export function templatePaymentRows(view: InvoiceView): TemplateRow[] {
  const p = view.payment;
  const rows: TemplateRow[] = [];
  if (p.mpesaNumber.trim()) {
    // Accept "Till 123456" as well as a bare number without printing "Till" twice.
    const number = /^(paybill|till)\b/i.test(p.mpesaNumber.trim()) ? p.mpesaNumber.trim() : `Paybill / Till ${p.mpesaNumber.trim()}`;
    rows.push({ label: "M-Pesa", value: `${number} \u00B7 Account ${p.mpesaAccount}` });
  }
  if (p.pochiNumber.trim()) rows.push({ label: "Phone", value: `Send Money / Pochi to ${p.pochiNumber.trim()}${p.pochiName.trim() ? ` \u00B7 Name ${p.pochiName.trim()}` : ""}` });
  const bank = [p.bankName, p.bankAccountName, p.bankAccountNumber].map((v) => v.trim()).filter(Boolean);
  if (bank.length) rows.push({ label: "Bank", value: bank.join(" \u00B7 ") });
  return rows;
}

/** "Payments received" rows: the date, then method, M-Pesa code / reference and amount. */
export function templatePaymentsReceived(view: InvoiceView): TemplateRow[] {
  return view.payments.map((p) => ({ label: p.date, value: [p.method, p.reference, formatInvoiceMoney(p.amount, view.currency)].filter(Boolean).join(" · ") }));
}

/** M-Pesa transaction codes are 10 letters and digits (e.g. SJK3H2L9QX); allow a little slack in length. */
export const MPESA_CODE_PATTERN = /^[A-Z0-9]{8,12}$/;
export function normaliseMpesaCode(value: string): string { return value.replace(/\s+/g, "").toUpperCase(); }

/** Contact lines for the business ("From") column. */
export function templateBusinessLines(view: InvoiceView): string[] {
  return [view.business.address, view.business.email, view.business.phone, view.business.website].filter((line) => Boolean(line && line.trim()));
}

/** Contact lines for the "Bill to" column. */
export function templateClientLines(view: InvoiceView): string[] {
  return [view.billTo.client, view.billTo.contact, view.billTo.address, view.billTo.email, view.billTo.phone].filter((line) => Boolean(line && line.trim()));
}

/** "Thank you for choosing 45Creatives · 45creative.co.ke" */
export function templateFooter(view: InvoiceView): string {
  return [`Thank you for choosing ${view.business.name || "45Creatives"}`, view.business.website].filter(Boolean).join(" \u00B7 ");
}
