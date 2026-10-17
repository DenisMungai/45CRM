import { useState } from "react";
import { Check, ClipboardPaste, Smartphone, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const day = (value: Date | string) => new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Nairobi" });

/** M-Pesa payments: paste a confirmation SMS, or receive them automatically via Daraja, and match them to invoices. */
export default function MpesaPanel({ openInvoices }: { openInvoices: { id: string; number: string; client: string; balance: string }[] }) {
  const utils = trpc.useUtils();
  const list = trpc.mpesa.list.useQuery();
  const [text, setText] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [matchTo, setMatchTo] = useState<Record<string, string>>({});
  const refresh = () => { utils.mpesa.list.invalidate(); utils.records.list.invalidate(); utils.invoiceDocs.summaries.invalidate(); utils.invoiceDocs.view.invalidate(); };
  const paste = trpc.mpesa.paste.useMutation({
    onSuccess: (result) => { setText(""); setInvoiceId(""); refresh(); if (result.duplicate) toast.info(`${result.transId} was already recorded.`); else if (result.matched) toast.success(`${result.transId}: KSh ${result.amount.toLocaleString("en-KE")} recorded against the invoice.`); else toast.warning(`${result.transId} saved, but no invoice matched${result.accountRef ? ` account "${result.accountRef}"` : ""}. Match it below.`); },
    onError: (error) => toast.error(error.message),
  });
  const match = trpc.mpesa.match.useMutation({ onSuccess: () => { toast.success("Payment recorded against the invoice"); refresh(); }, onError: (error) => toast.error(error.message) });
  const ignore = trpc.mpesa.ignore.useMutation({ onSuccess: () => refresh(), onError: (error) => toast.error(error.message) });
  const rows = list.data || [];
  const unmatched = rows.filter((r) => r.status === "unmatched");
  return <section className="panel mpesa-panel">
    <div className="panel-head"><h2 className="panel-title"><Smartphone size={13} /> M-Pesa payments</h2><span className="panel-subtle">{unmatched.length ? `${unmatched.length} to match` : "All matched"}</span></div>
    <div className="mpesa-body">
      <form className="mpesa-paste" onSubmit={(e) => { e.preventDefault(); paste.mutate({ text, invoiceId: invoiceId || undefined }); }}>
        <label>Paste an M-Pesa confirmation SMS<textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="QJK1ABC2DE Confirmed. Ksh5,000.00 received from JOHN DOE 2547… on 17/10/26 at 3:45 PM. Account Number 45C-INV-0001…" /></label>
        <label>Invoice (if the account number isn't the invoice number)<select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}><option value="">Match automatically</option>{openInvoices.map((i) => <option key={i.id} value={i.id}>{i.number} · {i.client} · {i.balance} due</option>)}</select></label>
        <button className="record-save" disabled={paste.isPending || text.trim().length < 10}><ClipboardPaste />{paste.isPending ? "Reading…" : "Record payment"}</button>
      </form>
      <p className="panel-subtle">Payments are matched when the M-Pesa account number is the invoice number (as the invoice asks), or when exactly one unpaid invoice has the same balance. With a Safaricom Daraja paybill, payments arrive here automatically: see Settings → Integrations.</p>
      {rows.length ? <div className="table-scroller"><table className="data-table"><thead><tr><th>Code</th><th>Received</th><th>From</th><th>Account</th><th>Amount</th><th>Invoice</th><th></th></tr></thead><tbody>{rows.slice(0, 15).map((r) => <tr key={r.id}>
        <td className="strong-cell">{r.transId}<small className="cell-sub">{r.source === "daraja" ? "Daraja" : "SMS"}</small></td>
        <td>{day(r.paidAt)}</td>
        <td>{r.payerName || "-"}{r.payerPhone ? <small className="cell-sub">{r.payerPhone}</small> : null}</td>
        <td>{r.accountRef || "-"}</td>
        <td className="value-cell">KSh {r.amount.toLocaleString("en-KE")}</td>
        <td>{r.status === "matched" ? <span className="status paid">{r.invoiceNumber || "Matched"}</span> : r.status === "ignored" ? <span className="status void">Ignored</span> : <select value={matchTo[r.id] || ""} aria-label={`Invoice for ${r.transId}`} onChange={(e) => setMatchTo((c) => ({ ...c, [r.id]: e.target.value }))}><option value="">Choose invoice…</option>{openInvoices.map((i) => <option key={i.id} value={i.id}>{i.number} · {i.client} · {i.balance}</option>)}</select>}</td>
        <td>{r.status === "unmatched" ? <div className="record-actions"><button className="record-edit" disabled={!matchTo[r.id] || match.isPending} onClick={() => match.mutate({ id: r.id, invoiceId: matchTo[r.id] })}><Check />Match</button><button className="record-delete" title="Not an invoice payment" onClick={() => ignore.mutate({ id: r.id })}><X />Ignore</button></div> : null}</td>
      </tr>)}</tbody></table></div> : null}
    </div>
  </section>;
}
