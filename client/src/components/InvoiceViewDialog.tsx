import { useEffect } from "react";
import { CircleDollarSign, Copy, ExternalLink, FileDown, Mail, MessageCircle, Pencil, X } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { formatInvoiceMoney } from "@shared/invoice";
import InvoiceSheet from "./InvoiceSheet";
import InvoiceDetailsDialog from "./InvoiceDetailsDialog";
import { useInvoiceActions } from "./useInvoiceActions";

const tone = (status: string) => status === "PAID" ? "paid" : status === "OVERDUE" || status === "VOID" ? "overdue" : status === "DRAFT" ? "draft" : "sent";

/** Popup opened from the Invoices list, same pattern as the agreement popup in Contracts. */
export default function InvoiceViewDialog({ invoiceId, number, clientName, onClose, onRecordPayment, onTotalChange, onOpenFull }: { invoiceId: string | null; number: string; clientName: string; onClose: () => void; onRecordPayment: () => void; onTotalChange: (total: number) => void; onOpenFull: () => void }) {
  const detail = trpc.invoiceDocs.view.useQuery({ invoiceId: invoiceId || "", clientName }, { enabled: Boolean(invoiceId), retry: false });
  const data = detail.data;
  const a = useInvoiceActions({ invoiceId: invoiceId || "", hasDocument: Boolean(data?.hasDocument), onTotalChange });
  useEffect(() => { a.setSendResult(null); }, [invoiceId]);
  if (!invoiceId) return null;
  return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="record-dialog panel contract-view-dialog" role="dialog" aria-modal="true" aria-labelledby="invoice-view-title" onMouseDown={(e) => e.stopPropagation()}>
      <div className="record-dialog-head"><div><span className="eyebrow">{clientName}</span><h2 id="invoice-view-title">{number}</h2></div><button className="record-close" aria-label="Close" onClick={onClose}><X /></button></div>
      {detail.isLoading ? <p className="activity-empty">Loading invoice…</p> : detail.isError ? <div className="contract-link-box"><span>{detail.error.message}</span><button className="text-button" onClick={() => detail.refetch()}>Try again</button></div> : data ? <>
        <div className="contract-status-row"><span className={`status ${tone(data.view.status)}`}>{data.view.status}</span><span className="panel-subtle">{formatInvoiceMoney(data.view.totals.total)} total · {formatInvoiceMoney(data.view.totals.balance)} balance due</span></div>
        <div className="contract-signer-row"><div><strong>{data.hasDocument ? "Invoice details saved" : "Invoice details needed"}</strong><span>{data.sentAt ? `Last sent by ${data.lastSentChannel === "whatsapp" ? "WhatsApp" : "email"} on ${new Date(data.sentAt).toLocaleString()}` : data.hasDocument ? "Not sent yet" : "Add bill-to, line items and payment instructions before sending."}</span></div></div>
        <div className="contract-actions-row">
          {!data.hasDocument ? <button className="primary" onClick={() => a.setEditing(true)}><Pencil />Add invoice details</button> : <>
            <button disabled={a.sending !== null} onClick={() => a.startSend("email")}><Mail />{a.sending === "email" ? "Preparing..." : "Open Gmail draft"}</button>
            <button disabled={a.sending !== null} onClick={() => a.startSend("whatsapp")}><MessageCircle />{a.sending === "whatsapp" ? "Preparing..." : "Open WhatsApp"}</button>
            <button onClick={() => a.setEditing(true)}><Pencil />Edit details</button></>}
          <button disabled={a.downloading} onClick={a.downloadPdf}><FileDown />{a.downloading ? "Preparing…" : "Download PDF"}</button>
          <button onClick={onRecordPayment}><CircleDollarSign />Record payment</button>
          <button onClick={onOpenFull}><ExternalLink />Open full page</button>
        </div>
        {a.sendResult ? <>
          <div className="contract-link-box"><ExternalLink size={12} /><span>{a.sendResult.viewUrl}</span><button className="text-button" onClick={() => a.copy(a.sendResult!.viewUrl)}><Copy size={11} />Copy</button></div>
          {a.sendResult.channel === "whatsapp" && a.sendResult.waLink ? <div className="contract-link-box"><MessageCircle size={12} /><span>WhatsApp message prepared. Review and send it in WhatsApp.</span><a className="text-button" href={a.sendResult.waLink} target="_blank" rel="noreferrer"><ExternalLink size={11} />Open WhatsApp</a></div> : null}
          {a.sendResult.channel === "email" ? <div className="contract-link-box"><Mail size={12} /><span>Gmail draft prepared. Review and send the email.</span><a className="text-button" href={a.sendResult.emailDraftUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} />Open Gmail</a></div> : null}
          <p className="panel-subtle">The draft contains the secure invoice link. Review it in the opened app and press Send.</p>
        </> : null}
        <div className="inv-dialog-sheet"><InvoiceSheet view={data.view} /></div>
        <InvoiceDetailsDialog open={a.editing} number={number} initial={data.fields} saving={a.save.isPending} onClose={() => a.setEditing(false)} onSubmit={(fields) => a.save.mutate({ invoiceId, fields })} />
      </> : null}
    </section>
  </div>;
}
