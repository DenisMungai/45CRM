import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { invoiceDocuments, invoices, payments, workspaces } from "../drizzle/schema.js";
import { buildInvoiceView, computeInvoiceTotals, defaultInvoiceFields, deriveInvoiceStatus, formatInvoiceDate, formatInvoiceMoney, INVOICE_TERMS, nextStoredInvoiceStatus, type InvoiceFields } from "../shared/invoice.js";
import { renderInvoicePdf, pdfSafe } from "./invoicePdf.js";

const DOC_ID = "11111111-1111-4111-8111-111111111111";
const doc = { id: DOC_ID, workspaceId: "22222222-2222-4222-8222-222222222222", invoiceId: "33333333-3333-4333-8333-333333333333", shareVersion: 1, sentAt: null, lastSentChannel: null, fields: {} as InvoiceFields, createdByUserId: null, createdAt: new Date(), updatedAt: new Date() };
const invoice = { id: doc.invoiceId, workspaceId: doc.workspaceId, clientId: null, projectId: null, quoteId: null, number: "45C-INV-0001", status: "draft", subtotal: 0, tax: 0, total: 0, amountPaid: 0, issueDate: new Date("2026-10-16T09:00:00Z"), dueDate: new Date("2026-10-30T09:00:00Z"), createdAt: new Date(), updatedAt: new Date() };
const workspace = { id: doc.workspaceId, name: "45Creatives", slug: "45", currency: "KES", timezone: "Africa/Nairobi", businessEmail: "hello@45creative.co.ke", businessPhone: "+254700000000", businessAddress: "Nairobi, Kenya", leadWebhookSecret: null, createdAt: new Date(), updatedAt: new Date() };

// A tiny stand-in for drizzle's query builder: enough for the lookups invoiceDocs performs.
vi.mock("./db.js", () => ({
  getDb: () => ({
    select: () => ({
      from: (table: unknown) => ({
        where: () => {
          const rows = table === invoiceDocuments ? [doc] : table === invoices ? [invoice] : table === workspaces ? [workspace] : table === payments ? [] : [];
          return Object.assign(Promise.resolve(rows), { limit: () => Promise.resolve(rows), orderBy: () => ({ limit: () => Promise.resolve(rows) }) });
        },
      }),
    }),
  }),
}));

const fields: InvoiceFields = {
  ...defaultInvoiceFields,
  clientName: "Acme Ltd", contactPerson: "Jane Wanjiku", clientEmail: "jane@acme.co.ke", clientPhone: "0712 345 678", billingAddress: "Westlands, Nairobi",
  projectName: "Acme website", scope: "5-page business site with CMS", quotationRef: "QT-2026-014", milestone: "Deposit",
  items: [{ description: "Website design & UI/UX", quantity: 1, unitPrice: 30000 }, { description: "CMS setup", quantity: 2, unitPrice: 7500 }],
  discount: 5000, mpesaNumber: "Till 123456", bankName: "Equity", bankAccountName: "45Creatives", bankAccountNumber: "0123456789", confirmationContact: "+254700000000",
};

describe("invoice totals", () => {
  it("computes line amounts, subtotal, discount, total and balance", () => {
    const totals = computeInvoiceTotals(fields.items, 5000, 20000);
    expect(totals.lines).toEqual([30000, 15000]);
    expect(totals).toMatchObject({ subtotal: 45000, discount: 5000, total: 40000, received: 20000, balance: 20000 });
  });
  it("never lets the discount exceed the subtotal or the balance go negative", () => {
    const totals = computeInvoiceTotals([{ description: "x", quantity: 1, unitPrice: 1000 }], 9999, 5000);
    expect(totals.discount).toBe(1000);
    expect(totals.total).toBe(0);
    expect(totals.balance).toBe(0);
  });
  it("formats money and Nairobi dates like the template", () => {
    expect(formatInvoiceMoney(1234.5)).toBe("KSh 1,234.50");
    expect(formatInvoiceDate("2026-10-16T21:30:00Z")).toBe("17 Oct 2026");
    expect(formatInvoiceDate(null)).toBe("-");
  });
});

describe("invoice status", () => {
  const base = { total: 40000, received: 0, dueDate: new Date("2026-10-30T00:00:00Z"), sent: false, now: new Date("2026-10-20T00:00:00Z") };
  it("is DRAFT until sent, then UNPAID", () => {
    expect(deriveInvoiceStatus({ ...base, storedStatus: "draft" })).toBe("DRAFT");
    expect(deriveInvoiceStatus({ ...base, storedStatus: "draft", sent: true })).toBe("UNPAID");
  });
  it("is PART-PAID with some payment and PAID once the balance is cleared", () => {
    expect(deriveInvoiceStatus({ ...base, storedStatus: "sent", received: 10000 })).toBe("PART-PAID");
    expect(deriveInvoiceStatus({ ...base, storedStatus: "sent", received: 40000 })).toBe("PAID");
    expect(deriveInvoiceStatus({ ...base, storedStatus: "paid" })).toBe("PAID");
  });
  it("is OVERDUE only after the due day has passed", () => {
    expect(deriveInvoiceStatus({ ...base, storedStatus: "sent", now: new Date("2026-10-30T20:00:00Z") })).toBe("UNPAID");
    expect(deriveInvoiceStatus({ ...base, storedStatus: "sent", now: new Date("2026-11-02T00:00:00Z") })).toBe("OVERDUE");
    expect(deriveInvoiceStatus({ ...base, storedStatus: "void" })).toBe("VOID");
  });
});

describe("invoice view", () => {
  const view = buildInvoiceView({
    number: "45C-INV-0001", storedStatus: "sent", issueDate: invoice.issueDate, dueDate: invoice.dueDate, sent: true,
    business: { name: "45Creatives", address: "Nairobi, Kenya", email: "hello@45creative.co.ke", phone: "+254700000000" }, fields,
    payments: [{ paidAt: "2026-10-18T10:00:00Z", method: "M-Pesa", number: "PAY-1", amount: 20000 }],
    now: new Date("2026-10-20T00:00:00Z"),
  });
  it("shows payments received, balance and the latest payment record", () => {
    expect(view.status).toBe("PART-PAID");
    expect(view.totals).toMatchObject({ total: 40000, received: 20000, balance: 20000 });
    expect(view.paymentRecord).toMatchObject({ method: "M-Pesa", reference: "PAY-1", amount: 20000, count: 1 });
    expect(view.payment.mpesaAccount).toBe("45C-INV-0001");
  });
  it("carries no KRA PIN, tax or VAT content", () => {
    const serialised = JSON.stringify(view).toLowerCase();
    for (const word of ["kra", "vat", "etims", "taxable", "tax /"]) expect(serialised).not.toContain(word);
    expect(INVOICE_TERMS).toHaveLength(2);
  });
});

describe("invoice share link", () => {
  it("round-trips, stays stable across sends and rejects tampering", async () => {
    const { createInvoiceToken, loadInvoiceBundleByToken } = await import("./invoiceDocs.js");
    const token = createInvoiceToken(doc);
    expect(createInvoiceToken(doc)).toBe(token);
    expect((await loadInvoiceBundleByToken(token))?.view.number).toBe("45C-INV-0001");
    expect(await loadInvoiceBundleByToken(`${DOC_ID}.${"A".repeat(43)}`)).toBeUndefined();
    expect(await loadInvoiceBundleByToken(`${DOC_ID}.`)).toBeUndefined();
    expect(await loadInvoiceBundleByToken("not-a-token")).toBeUndefined();
    // Bumping shareVersion revokes links that were issued before.
    expect(createInvoiceToken({ id: DOC_ID, shareVersion: 2 })).not.toBe(token);
  });
  it("builds the WhatsApp and Gmail hand-offs with the link in them", async () => {
    const { buildInvoiceDrafts } = await import("./invoiceDocs.js");
    const view = buildInvoiceView({ number: "45C-INV-0001", storedStatus: "sent", issueDate: invoice.issueDate, dueDate: invoice.dueDate, sent: true, business: { name: "45Creatives", address: "", email: "", phone: "" }, fields, payments: [] });
    const drafts = buildInvoiceDrafts(view, "jane@acme.co.ke", "0712 345 678", "https://crm.example.com/invoices/view/abc");
    expect(decodeURIComponent(drafts.waLink!)).toContain("https://crm.example.com/invoices/view/abc");
    expect(drafts.waLink).toContain("https://wa.me/254712345678");
    expect(decodeURIComponent(drafts.emailDraftUrl)).toContain("Invoice 45C-INV-0001 from 45Creatives");
    expect(decodeURIComponent(drafts.emailDraftUrl)).toContain("KSh 40,000.00");
  });
});

describe("invoice PDF", () => {
  const make = (overrides: Partial<InvoiceFields> = {}) => buildInvoiceView({
    number: "45C-INV-0002", storedStatus: "sent", issueDate: invoice.issueDate, dueDate: invoice.dueDate, sent: true,
    business: { name: "45Creatives", address: "Nairobi, Kenya", email: "hello@45creative.co.ke", phone: "+254700000000" }, fields: { ...fields, ...overrides }, payments: [],
  });
  it("renders a valid single-page A4 PDF", async () => {
    const bytes = await renderInvoicePdf(make());
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const parsed = await PDFDocument.load(bytes);
    expect(parsed.getPageCount()).toBe(1);
    expect(parsed.getTitle()).toBe("Invoice 45C-INV-0002");
  });
  it("does not throw on characters the built-in fonts cannot encode", async () => {
    expect(pdfSafe("Wanjĩrũ \u2013 Café \u{1F600}")).toBe("Wanjiru - Café ?");
    await expect(renderInvoicePdf(make({ clientName: "Wanjĩrũ & Sons \u{1F600}", notes: "Asante \u2014 karibu" }))).resolves.toBeInstanceOf(Uint8Array);
  });
  it("paginates long invoices", async () => {
    const items = Array.from({ length: 28 }, (_, i) => ({ description: `Line item ${i + 1} with a reasonably long description that wraps onto a second line in the table`, quantity: 1, unitPrice: 1000 }));
    const parsed = await PDFDocument.load(await renderInvoicePdf(make({ items })));
    expect(parsed.getPageCount()).toBeGreaterThan(1);
  });
});

describe("stored invoice status", () => {
  const base = { storedStatus: "draft", total: 40000, received: 0, sent: false };
  it("moves a draft to sent once it has been sent", () => {
    expect(nextStoredInvoiceStatus(base)).toBe("draft");
    expect(nextStoredInvoiceStatus({ ...base, sent: true })).toBe("sent");
  });
  it("follows recorded payments", () => {
    expect(nextStoredInvoiceStatus({ ...base, sent: true, received: 10000 })).toBe("partial");
    expect(nextStoredInvoiceStatus({ ...base, storedStatus: "sent", received: 40000 })).toBe("paid");
    expect(nextStoredInvoiceStatus({ ...base, storedStatus: "partial", sent: true })).toBe("sent");
  });
  it("keeps void and hand-set paid invoices as they are", () => {
    expect(nextStoredInvoiceStatus({ ...base, storedStatus: "void", received: 40000 })).toBe("void");
    expect(nextStoredInvoiceStatus({ ...base, storedStatus: "paid" })).toBe("paid");
  });
});
