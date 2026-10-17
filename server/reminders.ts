import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db.js";
import * as db from "./db.js";
import { invoiceReminders, workspaces } from "../drizzle/schema.js";
import { invoiceViewUrl, listInvoiceSummaries, loadInvoiceBundle } from "./invoiceDocs.js";
import { isEmailDeliveryConfigured, sendEmail } from "./emailDelivery.js";
import { buildWhatsAppLink } from "./whatsappDelivery.js";
import { daysUntil } from "../shared/renewal.js";
import { reminderStage } from "../shared/reminders.js";
import { formatInvoiceMoney, type InvoiceView } from "../shared/invoice.js";

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function reminderMessage(view: InvoiceView, viewUrl: string) {
  const sender = view.business.name || "45Creatives";
  const balance = formatInvoiceMoney(view.totals.balance, view.currency);
  const opener = view.status === "OVERDUE" ? `This is a friendly reminder that invoice ${view.number} was due on ${view.dueDate} and ${balance} is still outstanding.` : `This is a friendly reminder that invoice ${view.number} for ${balance} is due on ${view.dueDate}.`;
  const lines = [
    `Hi ${view.billTo.contact || view.billTo.client},`,
    "",
    opener,
    view.payment.mpesaNumber ? `M-Pesa: ${view.payment.mpesaNumber}, account ${view.payment.mpesaAccount}.` : null,
    "",
    "View and download the invoice here:",
    viewUrl,
    "",
    "If you've already paid, thank you, and please ignore this message.",
    "",
    "Regards,",
    sender,
  ].filter((line): line is string => line !== null);
  return { subject: `${view.status === "OVERDUE" ? "Overdue" : "Reminder"}: invoice ${view.number} from ${sender}`, text: lines.join("\n") };
}

export async function listReminders(workspaceId: string, invoiceId: string) {
  return getDb().select().from(invoiceReminders).where(and(eq(invoiceReminders.workspaceId, workspaceId), eq(invoiceReminders.invoiceId, invoiceId))).orderBy(desc(invoiceReminders.createdAt));
}

/** Prepares a reminder for the user to send from Gmail or WhatsApp, and records it. */
export async function prepareManualReminder(workspaceId: string, invoiceId: string, channel: "email" | "whatsapp") {
  const bundle = await loadInvoiceBundle(workspaceId, invoiceId);
  if (!bundle) return { error: "NOT_FOUND" as const };
  if (!bundle.document?.sentAt) return { error: "NOT_SENT" as const };
  if (bundle.view.status === "PAID" || bundle.view.status === "VOID") return { error: "SETTLED" as const };
  const target = channel === "email" ? bundle.fields.clientEmail : bundle.fields.clientPhone;
  if (!target) return { error: channel === "email" ? "NO_EMAIL" as const : "NO_PHONE" as const };
  const message = reminderMessage(bundle.view, invoiceViewUrl(bundle.document));
  await getDb().insert(invoiceReminders).values({ workspaceId, invoiceId, stage: `manual-${Date.now()}`, channel, status: "prepared" });
  return {
    channel,
    url: channel === "email"
      ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(target)}&su=${encodeURIComponent(message.subject)}&body=${encodeURIComponent(message.text)}`
      : buildWhatsAppLink(target, message.text),
  };
}

export type ReminderRunResult = { workspaces: number; sent: number; failed: number; skipped: string | null };

/**
 * The daily job: for each workspace with reminders switched on, email every sent, unpaid invoice
 * that has reached a reminder stage it hasn't had yet.
 */
export async function runPaymentReminders(now = new Date()): Promise<ReminderRunResult> {
  if (!isEmailDeliveryConfigured()) return { workspaces: 0, sent: 0, failed: 0, skipped: "Email delivery (RESEND_API_KEY / RESEND_FROM_EMAIL) is not configured." };
  const enabled = await getDb().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.remindersEnabled, true));
  let sent = 0, failed = 0;
  for (const workspace of enabled) {
    const summaries = await listInvoiceSummaries(workspace.id);
    for (const invoice of summaries) {
      if (!invoice.sentAt || !["UNPAID", "PART-PAID", "OVERDUE"].includes(invoice.status) || !invoice.dueDate || invoice.balance <= 0) continue;
      const stage = reminderStage(daysUntil(invoice.dueDate, now));
      if (!stage) continue;
      const already = await getDb().select({ id: invoiceReminders.id }).from(invoiceReminders).where(and(eq(invoiceReminders.invoiceId, invoice.id), eq(invoiceReminders.stage, stage), eq(invoiceReminders.channel, "email"))).limit(1);
      if (already.length) continue;
      const bundle = await loadInvoiceBundle(workspace.id, invoice.id);
      if (!bundle?.document || !bundle.fields.clientEmail) continue;
      const message = reminderMessage(bundle.view, invoiceViewUrl(bundle.document));
      try {
        await sendEmail({ to: bundle.fields.clientEmail, subject: message.subject, html: message.text.split("\n").map((line) => /^https?:\/\//.test(line) ? `<p><a href="${escapeHtml(line)}">${escapeHtml(line)}</a></p>` : line ? `<p>${escapeHtml(line)}</p>` : "").join("") });
        await getDb().insert(invoiceReminders).values({ workspaceId: workspace.id, invoiceId: invoice.id, stage, channel: "email", status: "sent" }).onConflictDoNothing();
        await db.appendDashboardActivity(workspace.id, [{ recordId: invoice.id, tableName: "invoices", action: "Reminder sent", detail: `Automatic payment reminder for ${invoice.number} emailed to ${bundle.fields.clientEmail}.`, actorUserId: null }]);
        sent++;
      } catch (error) {
        // Recorded as failed so it isn't retried every day; it shows in the invoice's reminder history.
        await getDb().insert(invoiceReminders).values({ workspaceId: workspace.id, invoiceId: invoice.id, stage, channel: "email", status: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "Delivery failed" }).onConflictDoNothing();
        failed++;
      }
    }
  }
  return { workspaces: enabled.length, sent, failed, skipped: null };
}
