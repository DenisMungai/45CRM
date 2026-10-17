import { describe, expect, it } from "vitest";
import { parseDarajaTime, parseMpesaSms } from "../shared/mpesa";
import { reminderStage } from "../shared/reminders";
import { buildInvoiceView, defaultInvoiceFields, deriveQuoteStatus, formatInvoiceMoney, receivedInDocCurrency, type InvoiceFields } from "../shared/invoice";
import { numberRevisions } from "./projectWork";
import { decryptSecret, encryptSecret } from "./vault";

describe("M-Pesa SMS parsing", () => {
  it("reads a paybill confirmation with an account number", () => {
    const parsed = parseMpesaSms("QJK1ABC2DE Confirmed. Ksh5,000.00 received from JOHN DOE 254712345678 on 17/10/26 at 3:45 PM. Account Number 45C-INV-0001 New Utility balance is Ksh12,000.00.");
    expect(parsed).toMatchObject({ transId: "QJK1ABC2DE", amount: 5000, payerName: "JOHN DOE", payerPhone: "254712345678", accountRef: "45C-INV-0001" });
    expect(parsed?.paidAt?.toISOString()).toBe("2026-10-17T12:45:00.000Z");
  });
  it("reads a personal 'you have received' message without an account", () => {
    const parsed = parseMpesaSms("RKL9XY8Z7W Confirmed.You have received Ksh1,250.50 from JANE W 0712345678 on 5/1/27 at 9:05 AM New M-PESA balance is Ksh3,000.00.");
    expect(parsed).toMatchObject({ transId: "RKL9XY8Z7W", amount: 1251, payerName: "JANE W", payerPhone: "0712345678", accountRef: null });
    expect(parsed?.paidAt?.toISOString()).toBe("2027-01-05T06:05:00.000Z");
  });
  it("rejects text that isn't a received payment", () => {
    expect(parseMpesaSms("Hello, please pay the invoice")).toBeNull();
    expect(parseMpesaSms("QJK1ABC2DE Confirmed. Ksh500.00 sent to KPLC PREPAID for account 1234")).toBeNull();
  });
  it("reads Daraja TransTime as Nairobi time", () => {
    expect(parseDarajaTime("20261017154500")?.toISOString()).toBe("2026-10-17T12:45:00.000Z");
    expect(parseDarajaTime("bad")).toBeNull();
  });
});

describe("payment reminder stages", () => {
  it("picks one stage per window and nothing in between", () => {
    expect(reminderStage(5)).toBeNull();
    expect(reminderStage(3)).toBe("before-due");
    expect(reminderStage(1)).toBe("before-due");
    expect(reminderStage(0)).toBe("due");
    expect(reminderStage(-2)).toBe("due");
    expect(reminderStage(-4)).toBeNull();
    expect(reminderStage(-7)).toBe("overdue-1");
    expect(reminderStage(-13)).toBe("overdue-1");
    expect(reminderStage(-15)).toBeNull();
    expect(reminderStage(-21)).toBe("overdue-2");
    expect(reminderStage(-34)).toBe("overdue-2");
    expect(reminderStage(-35)).toBe("overdue-3");
  });
});

describe("multi-currency documents", () => {
  const usd: InvoiceFields = { ...defaultInvoiceFields, clientName: "Globex", currency: "USD", exchangeRate: 130, items: [{ description: "Website", quantity: 1, unitPrice: 1000 }] };
  const business = { name: "45Creatives", address: "", email: "", phone: "" };
  it("shows amounts in the document currency and converts KES payments", () => {
    const view = buildInvoiceView({ number: "45C-INV-0009", storedStatus: "sent", issueDate: "2026-10-01", dueDate: "2026-12-01", sent: true, business, fields: usd, payments: [{ paidAt: "2026-10-05", method: "Bank", number: "TX1", amount: 65000 }], now: new Date("2026-10-10") });
    expect(view.currency).toBe("USD");
    expect(view.totals.total).toBe(1000);
    expect(view.totals.received).toBe(500);
    expect(view.totals.balance).toBe(500);
    expect(view.status).toBe("PART-PAID");
    expect(formatInvoiceMoney(view.totals.balance, view.currency)).toBe("USD 500.00");
  });
  it("treats a sub-shilling rounding remainder as paid", () => {
    expect(receivedInDocCurrency(1000, 129_999.6, 130)).toBe(1000);
    expect(receivedInDocCurrency(1000, 129_000, 130)).toBeCloseTo(992.31, 2);
  });
  it("labels quotations", () => {
    const view = buildInvoiceView({ kind: "quote", number: "QT-2026-001", storedStatus: "sent", issueDate: "2026-10-01", dueDate: "2026-10-31", sent: true, business, fields: usd, payments: [], decision: { decision: "accepted", by: "Ann", at: "2026-10-05", note: null }, now: new Date("2026-10-10") });
    expect(view.kind).toBe("quote");
    expect(view.status).toBe("ACCEPTED");
    expect(view.paymentRecord).toBeNull();
    expect(view.decision?.by).toBe("Ann");
  });
  it("derives quote status", () => {
    const now = new Date("2026-10-10T08:00:00Z");
    expect(deriveQuoteStatus({ decision: null, sent: false, validUntil: "2026-10-31", now })).toBe("DRAFT");
    expect(deriveQuoteStatus({ decision: null, sent: true, validUntil: "2026-10-31", now })).toBe("SENT");
    expect(deriveQuoteStatus({ decision: null, sent: true, validUntil: "2026-10-01", now })).toBe("EXPIRED");
    expect(deriveQuoteStatus({ decision: "declined", sent: true, validUntil: "2026-10-01", now })).toBe("DECLINED");
  });
});

describe("revision rounds", () => {
  it("numbers revisions in order and flags those past the included rounds", () => {
    const at = (day: number) => new Date(Date.UTC(2026, 9, day));
    const numbers = numberRevisions([
      { id: "a", kind: "revision", status: "done", createdAt: at(1) },
      { id: "b", kind: "change", status: "approved", createdAt: at(2) },
      { id: "c", kind: "revision", status: "declined", createdAt: at(3) },
      { id: "d", kind: "revision", status: "requested", createdAt: at(4) },
      { id: "e", kind: "revision", status: "requested", createdAt: at(5) },
    ], 2);
    expect(numbers.get("a")).toEqual({ revisionNumber: 1, overLimit: false });
    expect(numbers.has("b")).toBe(false);
    expect(numbers.has("c")).toBe(false);
    expect(numbers.get("d")).toEqual({ revisionNumber: 2, overLimit: false });
    expect(numbers.get("e")).toEqual({ revisionNumber: 3, overLimit: true });
  });
});

describe("vault secrets", () => {
  it("round-trips and never stores the plain text", () => {
    const stored = encryptSecret("hunter2-ñ");
    expect(stored).not.toContain("hunter2");
    expect(decryptSecret(stored)).toBe("hunter2-ñ");
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });
  it("rejects tampered secrets", () => {
    const [v, iv, tag, data] = encryptSecret("secret").split(".");
    expect(() => decryptSecret([v, iv, tag, data.slice(0, -2) + (data.endsWith("A") ? "BB" : "AA")].join("."))).toThrow();
  });
});
