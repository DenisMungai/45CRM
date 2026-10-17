import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { reminderStageLabel } from "@shared/reminders";
import { Ban, BellRing, CircleDollarSign, Copy, ExternalLink, FileDown, Mail, MessageCircle, Pencil, Printer, Trash2, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatInvoiceMoney } from "@shared/invoice";
import InvoiceSheet from "./InvoiceSheet";
import InvoiceDetailsDialog from "./InvoiceDetailsDialog";
import { useInvoiceActions } from "./useInvoiceActions";

export const invoiceStatusTone = (status: string) => status === "PAID" ? "paid" : status === "OVERDUE" || status === "VOID" ? "overdue" : status === "DRAFT" ? "draft" : status === "PART-PAID" ? "pending" : "sent";
const isoDate = (value: Date | string | null | undefined) => value ? new Date(value).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

export type InvoicePaymentTarget = { number: string; clientName: string; balance: number };

/** Invoice popup opened from the Invoices list - the same pattern as the agreement popup in Contracts. */
export default function InvoiceViewDialog({ invoiceId, onClose, onRecordPayment, onTotalChange, onDelete, rates = {} }: { invoiceId: string | null; onClose: () => void; onRecordPayment: (target: InvoicePaymentTarget) => void; onTotalChange: (total: number) => void; onDelete: (invoiceId: string, number: string) => void; rates?: Record<string, number> }) {
  const detail = trpc.invoiceDocs.view.useQuery({ invoiceId: invoiceId || "" }, { enabled: Boolean(invoiceId), retry: false });
  const data = detail.data;
  const a = useInvoiceActions({ invoiceId: invoiceId || "", hasDocument: Boolean(data?.hasDocument), onTotalChange });
  const utils = trpc.useUtils();
  const reminderList = trpc.reminders.list.useQuery({ invoiceId: invoiceId || "" }, { enabled: Boolean(invoiceId && data?.sentAt) });
  const reminderWindow = useRef<Window | null>(null);
  const remind = trpc.reminders.prepare.useMutation({
    onSuccess: (result) => { if (reminderWindow.current) reminderWindow.current.location.href = result.url; reminderWindow.current = null; utils.reminders.list.invalidate(); toast.success(result.channel === "email" ? "Reminder email ready in Gmail. Review and send." : "Reminder ready in WhatsApp. Review and send."); },
    onError: (error) => { reminderWindow.current?.close(); reminderWindow.current = null; toast.error(error.message); },
  });
  useEffect(() => { a.setSendResult(null); a.setEditing(false); }, [invoiceId]);
  if (!invoiceId) return null;
  const voided = Boolean(data?.voided);
  const voidInvoice = () => { if (data && window.confirm(`Void invoice ${data.view.number}? It stays on record as VOID and can no longer be sent or edited.`)) a.voidInvoice.mutate({ invoiceId }); };
  return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="record-dialog panel contract-view-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-view-title" onMouseDown={(e) => e.stopPropagation()}>
      <div className="record-dialog-head"><div><span className="eyebrow">{data?.view.billTo.client || "Invoice"}</span><h2 id="invoice-view-title">{data?.view.number || "Loading…"}</h2></div><button className="record-close" aria-label="Close" onClick={onClose}><X /></button></div>
      {detail.isLoading ? <p className="activity-empty">Loading invoice…</p> : detail.isError ? <div className="contract-link-box"><span>{detail.error.message}</span><button className="text-button" onClick={() => detail.refetch()}>Try again</button></div> : data ? <>
        <div className="contract-status-row"><span className={`status ${invoiceStatusTone(data.view.status)}`}>{data.view.status}</span><span className="panel-subtle">{formatInvoiceMoney(data.view.totals.total, data.view.currency)} total · {formatInvoiceMoney(data.view.totals.balance, data.view.currency)} balance due · due {data.view.dueDate}{data.view.currency !== "KES" ? ` · KSh ${data.view.exchangeRate} per ${data.view.currency}` : ""}</span></div>
        <div className="contract-signer-row"><div><strong>{voided ? "Invoice voided" : data.hasDocument ? "Invoice details saved" : "Invoice details needed"}</strong><span>{voided ? "This invoice is kept for your records and can no longer be sent." : data.sentAt ? `Last sent by ${data.lastSentChannel === "whatsapp" ? "WhatsApp" : "email"} on ${new Date(data.sentAt).toLocaleString()}` : data.hasDocument ? "Not sent yet" : "Add bill-to, line items and payment instructions before sending."}</span></div></div>
        <div className="contract-actions-row">
          {voided ? null : !data.hasDocument ? <button className="primary" onClick={() => a.setEditing(true)}><Pencil />Add invoice details</button> : <>
            <button className="primary" disabled={a.sending !== null} onClick={() => a.startSend("email")}><Mail />{a.sending === "email" ? "Preparing…" : "Send by email"}</button>
            <button disabled={a.sending !== null} onClick={() => a.startSend("whatsapp")}><MessageCircle />{a.sending === "whatsapp" ? "Preparing…" : "Send by WhatsApp"}</button>
            <button onClick={() => a.setEditing(true)}><Pencil />Edit details</button></>}
          <button disabled={a.downloading} onClick={a.downloadPdf}><FileDown />{a.downloading ? "Preparing…" : "Download PDF"}</button>
          <button onClick={() => window.print()}><Printer />Print</button>
          {!voided && data.view.totals.balance > 0 ? <button onClick={() => onRecordPayment({ number: data.view.number, clientName: data.view.billTo.client, balance: Math.round(data.view.totals.balance * (data.view.exchangeRate || 1)) })} title={data.view.currency !== "KES" ? "Payments are recorded in KES; the balance is converted at the invoice rate" : undefined}><CircleDollarSign />Record payment</button> : null}
          {!voided ? <button disabled={a.voidInvoice.isPending} onClick={voidInvoice}><Ban />Void</button> : null}
          <button className="contract-delete-button" onClick={() => onDelete(invoiceId, data.view.number)}><Trash2 />Delete</button>
        </div>
        {a.sendResult ? <>
          <div className="contract-link-box"><ExternalLink size={12} /><span>{a.sendResult.viewUrl}</span><button className="text-button" onClick={() => a.copy(a.sendResult!.viewUrl)}><Copy size={11} />Copy</button></div>
          {a.sendResult.channel === "whatsapp" && a.sendResult.waLink ? <div className="contract-link-box"><MessageCircle size={12} /><span>WhatsApp message prepared. Review and send it in WhatsApp.</span><a className="text-button" href={a.sendResult.waLink} target="_blank" rel="noreferrer"><ExternalLink size={11} />Open WhatsApp</a></div> : null}
          {a.sendResult.channel === "email" ? <div className="contract-link-box"><Mail size={12} /><span>Gmail draft prepared. Review and send the email.</span><a className="text-button" href={a.sendResult.emailDraftUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} />Open Gmail</a></div> : null}
          <p className="panel-subtle">The draft contains the secure invoice link. Review it in the opened app and press Send.</p>
        </> : null}
        {data.sentAt && !voided && data.view.totals.balance > 0 ? <div className="reminder-box">
          <div><strong><BellRing size={12} /> Payment reminders</strong><span>{reminderList.data?.length ? reminderList.data.slice(0, 4).map((r) => `${reminderStageLabel(r.stage)} · ${r.channel === "email" ? "email" : "WhatsApp"} · ${r.status}${r.status === "failed" && r.error ? ` (${r.error})` : ""} · ${new Date(r.createdAt).toLocaleDateString()}`).join("  |  ") : "No reminders yet. Automatic email reminders can be switched on in Settings -> Billing."}</span></div>
          <div className="contract-actions-row"><button disabled={remind.isPending} onClick={() => { reminderWindow.current = window.open("about:blank", "_blank"); remind.mutate({ invoiceId, channel: "email" }); }}><Mail />Remind by email</button><button disabled={remind.isPending} onClick={() => { reminderWindow.current = window.open("about:blank", "_blank"); remind.mutate({ invoiceId, channel: "whatsapp" }); }}><MessageCircle />Remind on WhatsApp</button></div>
        </div> : null}
        <div className="inv-dialog-sheet"><InvoiceSheet view={data.view} /></div>
        <InvoiceDetailsDialog rates={rates} open={a.editing} creating={false} number={data.view.number} initial={data.fields} initialMeta={{ number: data.view.number, issueDate: isoDate(data.issueDate), dueDate: isoDate(data.dueDate) }} saving={a.save.isPending} onClose={() => a.setEditing(false)} onSubmit={(fields, meta) => a.save.mutate({ invoiceId, fields, ...(meta ? { issueDate: meta.issueDate, dueDate: meta.dueDate } : {}) })} />
      </> : null}
    </section>
  </div>;
}
