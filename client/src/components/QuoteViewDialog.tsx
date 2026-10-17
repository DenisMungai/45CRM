import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, FileDown, Mail, MessageCircle, Pencil, ReceiptText, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { downloadBase64Pdf } from "@/lib/utils";
import { formatInvoiceMoney, type InvoiceFields } from "@shared/invoice";
import InvoiceSheet from "./InvoiceSheet";
import InvoiceDetailsDialog from "./InvoiceDetailsDialog";

export const quoteStatusTone = (status: string) => status === "ACCEPTED" ? "paid" : status === "DECLINED" || status === "EXPIRED" ? "overdue" : status === "DRAFT" ? "draft" : "sent";
const isoDate = (value: Date | string | null | undefined) => (value ? new Date(value) : new Date()).toISOString().slice(0, 10);

/** Quotation popup: edit line items, send by email / WhatsApp, download, and turn an accepted quote into an invoice. */
export default function QuoteViewDialog({ quoteId, onClose, onConvert, rates }: { quoteId: string | null; onClose: () => void; onConvert: (fields: InvoiceFields, number: string) => void; rates: Record<string, number> }) {
  const utils = trpc.useUtils();
  const detail = trpc.quoteDocs.view.useQuery({ quoteId: quoteId || "" }, { enabled: Boolean(quoteId), retry: false });
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState<"email" | "whatsapp" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sendResult, setSendResult] = useState<{ channel: "email" | "whatsapp"; viewUrl: string; waLink: string | null; emailDraftUrl: string } | null>(null);
  const composeWindow = useRef<Window | null>(null);
  useEffect(() => { setEditing(false); setSendResult(null); }, [quoteId]);
  const refresh = () => { utils.quoteDocs.view.invalidate(); utils.records.list.invalidate(); };
  const save = trpc.quoteDocs.save.useMutation({ onSuccess: () => { setEditing(false); refresh(); toast.success("Quotation saved"); }, onError: (error) => toast.error(error.message) });
  const send = trpc.quoteDocs.send.useMutation({
    onSuccess: (result) => { setSendResult(result); const url = result.channel === "whatsapp" ? result.waLink : result.emailDraftUrl; if (composeWindow.current && url) composeWindow.current.location.href = url; composeWindow.current = null; refresh(); toast.success(result.channel === "whatsapp" ? "WhatsApp is ready. Review and send the message." : "Gmail draft is ready. Review and send the email."); setSending(null); },
    onError: (error) => { composeWindow.current?.close(); composeWindow.current = null; toast.error(error.message); setSending(null); },
  });
  if (!quoteId) return null;
  const data = detail.data;
  const decided = data?.view.status === "ACCEPTED" || data?.view.status === "DECLINED";
  const startSend = (channel: "email" | "whatsapp") => {
    if (!data?.hasDocument) { setEditing(true); toast.info("Review and save the quotation details before sending."); return; }
    composeWindow.current = window.open("about:blank", "_blank");
    setSending(channel);
    send.mutate({ quoteId, channel });
  };
  const downloadPdf = async () => {
    setDownloading(true);
    try { const pdf = await utils.client.quoteDocs.downloadPdf.query({ quoteId }); downloadBase64Pdf(pdf.content, pdf.filename); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not generate the PDF"); }
    finally { setDownloading(false); }
  };
  const copy = (value: string) => { navigator.clipboard?.writeText(value).then(() => toast.success("Link copied")).catch(() => toast.error("Could not copy")); };
  return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="record-dialog panel contract-view-dialog" role="dialog" aria-modal="true" aria-labelledby="quote-view-title" onMouseDown={(e) => e.stopPropagation()}>
      <div className="record-dialog-head"><div><span className="eyebrow">{data?.view.billTo.client || "Quotation"}</span><h2 id="quote-view-title">{data?.view.number || "Loading…"}</h2></div><button className="record-close" aria-label="Close" onClick={onClose}><X /></button></div>
      {detail.isLoading ? <p className="activity-empty">Loading quotation…</p> : detail.isError ? <div className="contract-link-box"><span>{detail.error.message}</span><button className="text-button" onClick={() => detail.refetch()}>Try again</button></div> : data ? <>
        <div className="contract-status-row"><span className={`status ${quoteStatusTone(data.view.status)}`}>{data.view.status}</span><span className="panel-subtle">{formatInvoiceMoney(data.view.totals.total, data.view.currency)} · valid until {data.view.dueDate}</span></div>
        <div className="contract-signer-row"><div><strong>{data.view.decision ? `${data.view.status === "ACCEPTED" ? "Accepted" : "Declined"} by ${data.view.decision.by} on ${data.view.decision.at}` : data.hasDocument ? (data.sentAt ? `Sent by ${data.lastSentChannel === "whatsapp" ? "WhatsApp" : "email"} on ${new Date(data.sentAt).toLocaleString()}` : "Not sent yet") : "Quotation details needed"}</strong><span>{data.view.decision?.note ? `Client note: ${data.view.decision.note}` : data.hasDocument ? "The client can view, download and accept it from the link." : "Add line items and save before sending."}</span></div></div>
        <div className="contract-actions-row">
          {!decided ? <>
            <button className="primary" disabled={sending !== null} onClick={() => startSend("email")}><Mail />{sending === "email" ? "Preparing…" : "Send by email"}</button>
            <button disabled={sending !== null} onClick={() => startSend("whatsapp")}><MessageCircle />{sending === "whatsapp" ? "Preparing…" : "Send by WhatsApp"}</button>
            <button onClick={() => setEditing(true)}><Pencil />{data.hasDocument ? "Edit details" : "Add details"}</button>
          </> : null}
          <button disabled={downloading} onClick={downloadPdf}><FileDown />{downloading ? "Preparing…" : "Download PDF"}</button>
          {data.view.status !== "DECLINED" ? <button onClick={() => onConvert({ ...data.fields, quotationRef: data.view.number }, data.view.number)} title="Start an invoice with this quotation's line items"><ReceiptText />Convert to invoice</button> : null}
          {data.viewUrl ? <button onClick={() => copy(data.viewUrl!)}><Copy />Copy client link</button> : null}
        </div>
        {sendResult ? <div className="contract-link-box"><ExternalLink size={12} /><span>{sendResult.viewUrl}</span><button className="text-button" onClick={() => copy(sendResult.viewUrl)}><Copy size={11} />Copy</button></div> : null}
        <div className="inv-dialog-sheet"><InvoiceSheet view={data.view} /></div>
        <InvoiceDetailsDialog kind="quote" rates={rates} open={editing} creating={false} number={data.view.number} initial={data.fields} initialMeta={{ number: data.view.number, issueDate: isoDate(data.issueDate), dueDate: isoDate(data.validUntil) }} saving={save.isPending} onClose={() => setEditing(false)} onSubmit={(fields, meta) => save.mutate({ quoteId, fields, ...(meta ? { validUntil: meta.dueDate } : {}) })} />
      </> : null}
    </section>
  </div>;
}
