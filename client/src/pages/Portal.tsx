import { useMemo, useRef, useState } from "react";
import { CalendarClock, Check, FileDown, FileSignature, FileText, FolderKanban, Link2, MessageSquarePlus, ReceiptText, Sparkles, TriangleAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { downloadBase64Pdf } from "@/lib/utils";
import { formatInvoiceMoney } from "@shared/invoice";
import { uploadVaultFile } from "@/components/ClientVault";

const day = (value: Date | string | null | undefined) => value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : "-";
const milestoneLabel: Record<string, string> = { pending: "Not started", "in-progress": "In progress", "awaiting-approval": "Waiting for your approval", approved: "Approved", "changes-requested": "Changes requested" };
const tone = (status: string) => /PAID|ACCEPTED|approved|signed|done/i.test(status) ? "paid" : /OVERDUE|DECLINED|EXPIRED|declined|changes/i.test(status) ? "overdue" : /awaiting|UNPAID|PART|SENT|sent|requested/i.test(status) ? "pending" : "draft";

/** The client's portal (`/portal/<token>`). */
export default function Portal() {
  const token = useMemo(() => decodeURIComponent(window.location.pathname.match(/\/portal\/([^/]+)/)?.[1] || ""), []);
  const utils = trpc.useUtils();
  const query = trpc.portal.get.useQuery({ token }, { enabled: token.length >= 20, retry: false });
  const [deciding, setDeciding] = useState<{ id: string; decision: "approved" | "changes-requested" } | null>(null);
  const [requesting, setRequesting] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const reset = () => { setDeciding(null); setRequesting(null); setNote(""); setTitle(""); };
  const decide = trpc.portal.decideMilestone.useMutation({ onSuccess: (_r, input) => { toast.success(input.decision === "approved" ? "Approved - thank you!" : "Thanks - your feedback was sent to the team."); reset(); query.refetch(); }, onError: (error) => toast.error(error.message) });
  const request = trpc.portal.requestChange.useMutation({ onSuccess: () => { toast.success("Request sent to the team."); reset(); query.refetch(); }, onError: (error) => toast.error(error.message) });
  const contractPdf = async (contractId: string) => {
    try { const pdf = await utils.client.portal.contractPdf.query({ token, contractId }); downloadBase64Pdf(pdf.content, pdf.filename); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not prepare the PDF."); }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let done = 0;
    for (const file of Array.from(files)) {
      try { await uploadVaultFile(`/api/portal/${encodeURIComponent(token)}/upload?name=${encodeURIComponent(file.name)}`, file); done++; }
      catch (error) { toast.error(error instanceof Error ? error.message : `Couldn't upload ${file.name}`); }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (done) { toast.success(`${done} file${done === 1 ? "" : "s"} sent to the team`); query.refetch(); }
  };
  const shell = (children: React.ReactNode) => <main className="sign-page portal-page"><div className="sign-shell portal-shell"><div className="sign-brand"><Sparkles /><span>{query.data?.business.name || "45Creatives"}</span></div>{children}</div></main>;
  if (token.length < 20) return shell(<div className="sign-state"><TriangleAlert size={28} /><h1>Portal link missing</h1><p>Please use the full link you were sent.</p></div>);
  if (query.isLoading) return shell(<div className="sign-state"><div className="sign-spinner" /><p>Loading your portal…</p></div>);
  if (query.isError || !query.data) return shell(<div className="sign-state"><TriangleAlert size={28} /><h1>Link unavailable</h1><p>{query.error?.message || "This portal can't be shown."}</p></div>);
  const data = query.data;
  const owed = data.invoices.filter((i) => i.balance > 0);
  const awaiting = data.projects.flatMap((p) => p.milestones.filter((m) => m.status === "awaiting-approval"));
  const nameField = <label>Your name<input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={160} autoComplete="name" /></label>;
  return shell(<div className="portal">
    <header className="portal-head"><div><span className="eyebrow">Client portal</span><h1>{data.client.name}</h1><p>Everything for your projects with {data.business.name || "us"} in one place.{data.business.email || data.business.phone ? ` Questions? ${[data.business.email, data.business.phone].filter(Boolean).join(" · ")}` : ""}</p></div></header>
    <section className="portal-stats">
      <div><span>Amount due</span><strong>{owed.length ? owed.map((i) => formatInvoiceMoney(i.balance, i.currency)).join(" + ") : "Nothing due"}</strong></div>
      <div><span>Waiting for you</span><strong>{awaiting.length ? `${awaiting.length} approval${awaiting.length === 1 ? "" : "s"}` : "Nothing"}</strong></div>
      <div><span>Projects</span><strong>{data.projects.length}</strong></div>
    </section>

    {data.projects.length ? <section className="portal-section"><h2><FolderKanban /> Projects</h2>{data.projects.map((p) => <article className="portal-card" key={p.id}>
      <div className="portal-card-head"><div><strong>{p.name}</strong><small>{p.dueDate ? `Target ${day(p.dueDate)}` : ""}</small></div><div className="portal-progress"><div><i style={{ width: `${Math.min(100, Math.max(0, p.progress))}%` }} /></div><span>{p.progress}%</span></div></div>
      {p.milestones.length ? <ol className="portal-milestones">{p.milestones.map((m) => <li key={m.id} className={m.status}>
        <div><strong>{m.title}</strong><span className={`status ${tone(m.status)}`}>{milestoneLabel[m.status] || m.status}</span>{m.dueDate ? <small>Due {day(m.dueDate)}</small> : null}</div>
        {m.description ? <p>{m.description}</p> : null}
        {m.decidedByName ? <p className="panel-subtle">{m.status === "approved" ? "Approved" : "Changes requested"} by {m.decidedByName} on {day(m.decidedAt)}{m.clientNote ? `: “${m.clientNote}”` : ""}</p> : null}
        {m.status === "awaiting-approval" ? deciding?.id === m.id ? <form className="portal-form" onSubmit={(e) => { e.preventDefault(); decide.mutate({ token, milestoneId: m.id, decision: deciding.decision, name: name.trim(), note: note.trim() || undefined }); }}>
          {nameField}
          <label>{deciding.decision === "approved" ? "Comment (optional)" : "What should change?"}<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} required={deciding.decision === "changes-requested"} maxLength={2000} /></label>
          <div className="contract-actions-row"><button type="button" onClick={reset}>Cancel</button><button className="primary" disabled={decide.isPending || name.trim().length < 2 || (deciding.decision === "changes-requested" && !note.trim())}>{decide.isPending ? "Sending…" : deciding.decision === "approved" ? "Confirm approval" : "Send feedback"}</button></div>
        </form> : <div className="contract-actions-row"><button className="primary" onClick={() => { reset(); setDeciding({ id: m.id, decision: "approved" }); }}><Check />Approve</button><button onClick={() => { reset(); setDeciding({ id: m.id, decision: "changes-requested" }); }}>Request changes</button></div> : null}
      </li>)}</ol> : <p className="panel-subtle">Milestones will appear here as the project is planned.</p>}
      {p.changeRequests.length ? <div className="portal-changes"><h3>Change requests</h3>{p.changeRequests.map((c) => <div key={c.id}><span>{c.title}</span><span className={`status ${tone(c.status)}`}>{c.status}</span></div>)}</div> : null}
      {requesting === p.id ? <form className="portal-form" onSubmit={(e) => { e.preventDefault(); request.mutate({ token, projectId: p.id, title: title.trim(), description: note.trim() || undefined, name: name.trim() }); }}>
        {nameField}
        <label>What would you like?<input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={200} placeholder="e.g. Add a gallery page" /></label>
        <label>Details (optional)<textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} /></label>
        <div className="contract-actions-row"><button type="button" onClick={reset}>Cancel</button><button className="primary" disabled={request.isPending || name.trim().length < 2 || title.trim().length < 3}>{request.isPending ? "Sending…" : "Send request"}</button></div>
      </form> : <button className="text-button portal-request" onClick={() => { reset(); setRequesting(p.id); }}><MessageSquarePlus size={12} />Request a change</button>}
    </article>)}</section> : null}

    <section className="portal-section"><h2><ReceiptText /> Invoices</h2>{data.invoices.length ? <div className="portal-list">{data.invoices.map((i) => <div key={i.number}><div><strong>{i.number}</strong><small>Issued {day(i.issueDate)} · due {day(i.dueDate)}</small></div><span>{formatInvoiceMoney(i.total, i.currency)}</span><span className={`status ${tone(i.status)}`}>{i.status}</span>{i.url ? <a className="record-edit" href={i.url} target="_blank" rel="noreferrer"><FileText />View</a> : null}</div>)}</div> : <p className="panel-subtle">No invoices yet.</p>}</section>
    {data.quotes.length ? <section className="portal-section"><h2><FileText /> Quotations</h2><div className="portal-list">{data.quotes.map((q) => <div key={q.number}><div><strong>{q.number}</strong><small>Valid until {day(q.validUntil)}</small></div><span>{formatInvoiceMoney(q.total, q.currency)}</span><span className={`status ${tone(q.status)}`}>{q.status}</span><a className="record-edit" href={q.url} target="_blank" rel="noreferrer"><FileText />{q.status === "SENT" ? "Review & accept" : "View"}</a></div>)}</div></section> : null}
    {data.contracts.length ? <section className="portal-section"><h2><FileSignature /> Agreements</h2><div className="portal-list">{data.contracts.map((c) => <div key={c.id}><div><strong>{c.title}</strong><small>{c.status === "signed" ? `Signed ${day(c.clientSignedAt)}` : "Waiting for your signature - use the signing link we sent you"}</small></div><span className={`status ${tone(c.status)}`}>{c.status === "signed" ? "Signed" : "To sign"}</span>{c.status === "signed" ? <button className="record-edit" onClick={() => contractPdf(c.id)}><FileDown />PDF</button> : null}</div>)}</div></section> : null}
    <section className="portal-section"><h2><FileDown /> Files</h2>
      <div className="portal-upload"><label className="record-edit"><input ref={fileInput} type="file" multiple disabled={uploading} onChange={(e) => upload(e.target.files)} /><Upload />{uploading ? "Uploading…" : "Upload content for the team"}</label><span className="panel-subtle">Logos, photos, copy and documents, up to 4 MB each.</span></div>
      {data.files.length ? <div className="portal-list">{data.files.map((f) => <div key={f.id}><div><strong>{f.name}</strong><small>{f.kind === "file" ? `${f.source === "client" ? "Uploaded by you" : "Shared by the team"} · ${day(f.createdAt)}` : "Link"}</small></div>{f.kind === "link" && f.url ? <a className="record-edit" href={f.url} target="_blank" rel="noreferrer"><Link2 />Open</a> : <a className="record-edit" href={`/api/portal/${encodeURIComponent(token)}/files/${f.id}?download=1`}><FileDown />Download</a>}</div>)}</div> : <p className="panel-subtle">No shared files yet.</p>}
    </section>
    {data.renewals.length ? <section className="portal-section"><h2><CalendarClock /> Services &amp; renewals</h2><div className="portal-list">{data.renewals.map((r) => <div key={`${r.name}-${r.type}`}><div><strong>{r.name}</strong><small>{r.type} · renews {day(r.nextDueDate)}</small></div>{r.amount ? <span>{formatInvoiceMoney(r.amount)} / {r.cycle === "monthly" ? "month" : r.cycle === "quarterly" ? "quarter" : "year"}</span> : null}</div>)}</div></section> : null}
  </div>);
}
