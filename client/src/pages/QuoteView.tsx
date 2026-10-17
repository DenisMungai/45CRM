import { useMemo, useState } from "react";
import { Check, FileDown, Printer, Sparkles, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { downloadBase64Pdf } from "@/lib/utils";
import InvoiceSheet from "@/components/InvoiceSheet";

/** Public quotation page (`/quotes/view/<token>`): view, download, and accept or decline. */
export default function QuoteView() {
  const token = useMemo(() => decodeURIComponent(window.location.pathname.match(/\/quotes\/view\/([^/]+)/)?.[1] || ""), []);
  const utils = trpc.useUtils();
  const query = trpc.quoteDocs.getByToken.useQuery({ token }, { enabled: token.length >= 20, retry: false });
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"accepted" | "declined" | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const decide = trpc.quoteDocs.decide.useMutation({ onSuccess: () => { toast.success(mode === "accepted" ? "Thank you - the quotation is accepted." : "Your response has been recorded."); setMode(null); query.refetch(); }, onError: (error) => toast.error(error.message) });
  const download = async () => {
    setBusy(true);
    try { const pdf = await utils.client.quoteDocs.downloadPdfByToken.query({ token }); downloadBase64Pdf(pdf.content, pdf.filename); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not prepare the PDF."); }
    finally { setBusy(false); }
  };
  const shell = (children: React.ReactNode) => <main className="sign-page inv-public"><div className="sign-shell inv-shell"><div className="sign-brand"><Sparkles /><span>45Creatives</span></div>{children}</div></main>;
  if (token.length < 20) return shell(<div className="sign-state"><TriangleAlert size={28} /><h1>Quotation link missing</h1><p>Please use the link from your email or WhatsApp message.</p></div>);
  if (query.isLoading) return shell(<div className="sign-state"><div className="sign-spinner" /><p>Loading your quotation…</p></div>);
  if (query.isError || !query.data) return shell(<div className="sign-state"><TriangleAlert size={28} /><h1>Link unavailable</h1><p>{query.error?.message || "This quotation can't be shown."}</p></div>);
  const view = query.data.view;
  const open = view.status === "SENT";
  return shell(<>
    <div className="inv-public-actions">
      {open ? <><button className="primary" onClick={() => setMode("accepted")}><Check />Accept quotation</button><button onClick={() => setMode("declined")}><X />Decline</button></> : null}
      <button disabled={busy} onClick={download}><FileDown />{busy ? "Preparing…" : "Download PDF"}</button>
      <button onClick={() => window.print()}><Printer />Print</button>
    </div>
    {view.status === "EXPIRED" ? <p className="quote-banner">This quotation has expired. Please contact {view.business.name || "us"} for an updated one.</p> : null}
    {view.decision ? <p className="quote-banner">{view.status === "ACCEPTED" ? "Accepted" : "Declined"} by {view.decision.by} on {view.decision.at}. Thank you.</p> : null}
    {mode ? <form className="quote-decision panel" onSubmit={(event) => { event.preventDefault(); decide.mutate({ token, decision: mode, name: name.trim(), note: note.trim() || undefined }); }}>
      <h2>{mode === "accepted" ? "Accept this quotation" : "Decline this quotation"}</h2>
      <p>{mode === "accepted" ? `By accepting, you agree to the scope and prices in ${view.number}. We'll be in touch about the deposit and next steps.` : "Let us know why, so we can help - for example a change in scope or budget."}</p>
      <label>Your full name<input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={160} autoComplete="name" /></label>
      <label>{mode === "accepted" ? "Note (optional)" : "Reason (optional)"}<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></label>
      <div className="contract-actions-row"><button type="button" onClick={() => setMode(null)}>Cancel</button><button className="primary" disabled={decide.isPending || name.trim().length < 2}>{decide.isPending ? "Saving…" : mode === "accepted" ? "Confirm acceptance" : "Confirm"}</button></div>
    </form> : null}
    <InvoiceSheet view={view} />
  </>);
}
