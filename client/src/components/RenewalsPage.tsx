import { useEffect, useState } from "react";
import { CalendarClock, Check, Pencil, Plus, ReceiptText, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { annualAmount, daysUntil, isRenewalCycle, RENEWAL_CYCLE_LABELS, RENEWAL_CYCLES, RENEWAL_NOTICE_DAYS, RENEWAL_TYPE_LABELS, RENEWAL_TYPES, renewalUrgency, type RenewalCycle, type RenewalType } from "@shared/renewal";

type Renewal = { id: string; clientName: string; type: string; name: string; provider: string | null; cycle: string; amount: number; cost: number; nextDueDate: Date | string; status: string; notes: string | null; lastInvoicedAt: Date | string | null };
type Form = { id?: string; clientName: string; type: RenewalType; name: string; provider: string; cycle: RenewalCycle; amount: string; cost: string; nextDueDate: string; status: "active" | "cancelled"; notes: string };

const ksh = (value: number) => `KSh ${Math.round(value).toLocaleString("en-KE")}`;
const day = (value: Date | string | null) => value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : "-";
const isoDay = (value: Date | string) => new Date(value).toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" });
const cycleOf = (renewal: Renewal): RenewalCycle => isRenewalCycle(renewal.cycle) ? renewal.cycle : "yearly";
const typeLabel = (type: string) => RENEWAL_TYPE_LABELS[type as RenewalType] || type;
const emptyForm = (): Form => ({ clientName: "", type: "hosting", name: "", provider: "", cycle: "yearly", amount: "", cost: "", nextDueDate: isoDay(new Date(Date.now() + 30 * 86_400_000)), status: "active", notes: "" });
const toForm = (r: Renewal): Form => ({ id: r.id, clientName: r.clientName, type: (RENEWAL_TYPES as readonly string[]).includes(r.type) ? r.type as RenewalType : "other", name: r.name, provider: r.provider || "", cycle: cycleOf(r), amount: String(r.amount || ""), cost: String(r.cost || ""), nextDueDate: isoDay(r.nextDueDate), status: r.status === "cancelled" ? "cancelled" : "active", notes: r.notes || "" });

function dueLabel(renewal: Renewal) {
  const urgency = renewalUrgency(renewal);
  if (urgency === "cancelled") return { text: "Cancelled", tone: "void" };
  const days = daysUntil(renewal.nextDueDate);
  if (days < 0) return { text: `${-days} day${days === -1 ? "" : "s"} overdue`, tone: "overdue" };
  if (days === 0) return { text: "Due today", tone: "overdue" };
  if (urgency === "due-soon") return { text: `In ${days} day${days === 1 ? "" : "s"}`, tone: "pending" };
  return { text: `In ${days} days`, tone: "active" };
}

function RenewalDialog({ open, initial, clients, saving, onClose, onSave }: { open: boolean; initial: Form; clients: string[]; saving: boolean; onClose: () => void; onSave: (form: Form) => void }) {
  const [form, setForm] = useState<Form>(initial);
  // Reset only when the dialog opens, so a background refetch never wipes what's being typed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setForm(initial); }, [open]);
  if (!open) return null;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((current) => ({ ...current, [key]: value }));
  const amount = Number(form.amount) || 0, cost = Number(form.cost) || 0;
  const problem = !form.clientName.trim() ? "Choose the client." : !form.name.trim() ? "Name the service, e.g. acme.co.ke or Acme website hosting." : !form.nextDueDate ? "Set the next renewal date." : "";
  return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="record-dialog panel contract-dialog" role="dialog" aria-modal="true" aria-labelledby="renewal-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="record-dialog-head"><div><span className="eyebrow">Recurring service</span><h2 id="renewal-title">{form.id ? "Edit renewal" : "New renewal"}</h2></div><button className="record-close" aria-label="Close" onClick={onClose}><X /></button></div>
      <div className="contract-form-sections">
        <fieldset><legend>Service</legend><div className="record-fields">
          <label>Client<input list="renewal-clients" value={form.clientName} onChange={(e) => set("clientName", e.target.value)} placeholder="Client name" /><datalist id="renewal-clients">{clients.map((name) => <option key={name} value={name} />)}</datalist></label>
          <label>Type<select value={form.type} onChange={(e) => set("type", e.target.value as RenewalType)}>{RENEWAL_TYPES.map((type) => <option key={type} value={type}>{RENEWAL_TYPE_LABELS[type]}</option>)}</select></label>
          <label className="wide">Service name<input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={form.type === "domain" ? "acme.co.ke" : "Acme website hosting"} /></label>
          <label>Provider<input value={form.provider} onChange={(e) => set("provider", e.target.value)} placeholder="Truehost, Hostinger, KeNIC…" /></label>
          <label>Status<select value={form.status} onChange={(e) => set("status", e.target.value as Form["status"])}><option value="active">Active</option><option value="cancelled">Cancelled</option></select></label>
        </div></fieldset>
        <fieldset><legend>Billing</legend><div className="record-fields">
          <label>Billing cycle<select value={form.cycle} onChange={(e) => set("cycle", e.target.value as RenewalCycle)}>{RENEWAL_CYCLES.map((cycle) => <option key={cycle} value={cycle}>{RENEWAL_CYCLE_LABELS[cycle]}</option>)}</select></label>
          <label>Next renewal date<input type="date" value={form.nextDueDate} onChange={(e) => set("nextDueDate", e.target.value)} /></label>
          <label>Client price per cycle (KES)<input type="number" min="0" value={form.amount} onChange={(e) => set("amount", e.target.value)} /></label>
          <label>Your provider cost per cycle (KES)<input type="number" min="0" value={form.cost} onChange={(e) => set("cost", e.target.value)} /></label>
        </div><p className="panel-subtle">{amount ? `${ksh(annualAmount(amount, form.cycle))} a year from the client · ${ksh(annualAmount(amount - cost, form.cycle))} a year margin` : "Leave the price at 0 for services you don't bill (e.g. a client-owned domain you just track)."}</p></fieldset>
        <fieldset><legend>Notes</legend><textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Login location, auto-renew settings, anything to remember" /></fieldset>
      </div>
      {problem ? <p className="panel-subtle" role="alert">{problem}</p> : null}
      <div className="record-dialog-actions"><button className="record-reset" onClick={onClose}>Cancel</button><button className="record-save" disabled={saving || Boolean(problem)} onClick={() => onSave(form)}><Check />{saving ? "Saving…" : form.id ? "Save changes" : "Add renewal"}</button></div>
    </section>
  </div>;
}

/** Hosting, domains, maintenance retainers and other recurring services, with one-click renewal invoices. */
export default function RenewalsPage({ query, clients, onOpenInvoice }: { query: string; clients: string[]; onOpenInvoice: (invoiceId: string) => void }) {
  const utils = trpc.useUtils();
  const list = trpc.renewals.list.useQuery();
  const [dialog, setDialog] = useState<Form | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("Active");
  const refresh = () => { utils.renewals.list.invalidate(); };
  const save = trpc.renewals.upsert.useMutation({ onSuccess: (saved) => { toast.success(`${saved.name} saved`); setDialog(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const remove = trpc.renewals.delete.useMutation({ onSuccess: () => { toast.success("Renewal deleted"); refresh(); }, onError: (error) => toast.error(error.message) });
  const invoice = trpc.renewals.invoice.useMutation({
    onSuccess: (result) => { toast.success(`Invoice ${result.number} drafted. Next renewal ${day(result.nextDueDate)}.`); refresh(); utils.invoiceDocs.summaries.invalidate(); utils.records.list.invalidate(); utils.invoiceDocs.nextNumber.invalidate(); onOpenInvoice(result.invoiceId); },
    onError: (error) => toast.error(error.message),
  });
  const renewals = (list.data || []) as Renewal[];
  const active = renewals.filter((r) => r.status !== "cancelled");
  const overdue = active.filter((r) => renewalUrgency(r) === "overdue");
  const dueSoon = active.filter((r) => renewalUrgency(r) === "due-soon");
  const yearly = active.reduce((sum, r) => sum + annualAmount(r.amount, cycleOf(r)), 0);
  const yearlyMargin = active.reduce((sum, r) => sum + annualAmount(r.amount - r.cost, cycleOf(r)), 0);
  const dueSoonValue = dueSoon.reduce((sum, r) => sum + r.amount, 0);
  const matches = (r: Renewal, text: string) => !text.trim() || `${r.name} ${r.clientName} ${r.provider || ""} ${typeLabel(r.type)}`.toLowerCase().includes(text.trim().toLowerCase());
  const visible = renewals.filter((r) => (filter === "All" || (filter === "Active" ? r.status !== "cancelled" : filter === "Cancelled" ? r.status === "cancelled" : filter === "Due soon" ? ["overdue", "due-soon"].includes(renewalUrgency(r)) : typeLabel(r.type) === filter)) && matches(r, search) && matches(r, query));
  const save_ = (form: Form) => save.mutate({ id: form.id, clientName: form.clientName, type: form.type, name: form.name, provider: form.provider || null, cycle: form.cycle, amount: Math.max(0, Math.round(Number(form.amount) || 0)), cost: Math.max(0, Math.round(Number(form.cost) || 0)), nextDueDate: new Date(`${form.nextDueDate}T00:00:00Z`), status: form.status, notes: form.notes || null });
  return <div className="page-content">
    <div className="page-heading"><div><h1>Renewals</h1><p>Hosting, domains, maintenance and other recurring services you bill clients for</p></div><button className="heading-action" onClick={() => setDialog(emptyForm())}><Plus />Add Renewal</button></div>
    <section className="metric-grid">
      <div className="metric-card"><div className="metric-label">Recurring revenue</div><div className="metric-value">{ksh(yearly)}</div><div className="metric-meta">per year · {active.length} active service{active.length === 1 ? "" : "s"}</div></div>
      <div className="metric-card is-success"><div className="metric-label">Annual margin</div><div className="metric-value">{ksh(yearlyMargin)}</div><div className="metric-meta">after provider costs</div></div>
      <div className={`metric-card ${dueSoon.length ? "is-danger" : ""}`}><div className="metric-label">Due in {RENEWAL_NOTICE_DAYS} days</div><div className="metric-value">{dueSoon.length}</div><div className="metric-meta">{dueSoonValue ? `${ksh(dueSoonValue)} to bill` : "Nothing coming up"}</div></div>
      <div className={`metric-card ${overdue.length ? "is-danger" : ""}`}><div className="metric-label">Overdue</div><div className="metric-value">{overdue.length}</div><div className={`metric-meta ${overdue.length ? "negative" : ""}`}>{overdue.length ? `${ksh(overdue.reduce((sum, r) => sum + r.amount, 0))} past the renewal date` : "All renewals on time"}</div></div>
    </section>
    <div className="filterbar table-discovery"><label className="searchbox"><Search /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search renewals…" aria-label="Search renewals" /></label><label className="table-filter"><SlidersHorizontal /><select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter renewals">{["Active", "Due soon", "Cancelled", "All", ...RENEWAL_TYPES.map((t) => RENEWAL_TYPE_LABELS[t])].map((option) => <option key={option}>{option}</option>)}</select></label><span className="panel-subtle">{visible.length} renewal{visible.length === 1 ? "" : "s"}</span></div>
    <div className="panel table-panel"><div className="table-scroller"><table className="data-table">
      <thead><tr><th>Service</th><th>Client</th><th>Type</th><th>Cycle</th><th>Next renewal</th><th>Client price</th><th>Margin</th><th></th></tr></thead>
      <tbody>{list.isLoading ? <tr><td colSpan={8} className="activity-empty">Loading renewals…</td></tr> : list.isError ? <tr><td colSpan={8} className="activity-empty">{list.error.message} <button className="text-button" onClick={() => list.refetch()}>Try again</button></td></tr> : renewals.length === 0 ? <tr><td colSpan={8} className="activity-empty">No renewals yet. Add a client's hosting, domain or maintenance plan, or use “Track renewals” on a signed agreement.</td></tr> : visible.length === 0 ? <tr><td colSpan={8} className="activity-empty">No renewals match this view.</td></tr> : visible.map((r) => { const due = dueLabel(r); return <tr key={r.id}>
        <td className="strong-cell">{r.name}{r.provider ? <small className="cell-sub">{r.provider}</small> : null}</td>
        <td>{r.clientName}</td>
        <td>{typeLabel(r.type)}</td>
        <td>{RENEWAL_CYCLE_LABELS[cycleOf(r)]}</td>
        <td className="due-cell">{day(r.nextDueDate)} <span className={`status ${due.tone}`}>{due.text}</span></td>
        <td className="value-cell">{r.amount ? ksh(r.amount) : <span className="panel-subtle">Not billed</span>}</td>
        <td className={`value-cell ${r.amount - r.cost < 0 ? "danger" : ""}`}>{r.amount || r.cost ? ksh(r.amount - r.cost) : "-"}</td>
        <td><div className="record-actions">{r.status !== "cancelled" ? <button className="record-edit" disabled={invoice.isPending || !r.amount} title={r.amount ? "Draft an invoice for the next period and move the renewal date on one cycle" : "Set a client price to invoice this renewal"} onClick={() => { if (window.confirm(`Draft an invoice for ${r.name} (${ksh(r.amount)}) and move its renewal date on one ${cycleOf(r) === "monthly" ? "month" : cycleOf(r) === "quarterly" ? "quarter" : "year"}?`)) invoice.mutate({ id: r.id }); }}><ReceiptText />Invoice & renew</button> : null}<button className="record-edit" onClick={() => setDialog(toForm(r))}><Pencil />Edit</button><button className="record-delete" disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete the ${typeLabel(r.type).toLowerCase()} renewal for ${r.name}? Invoices already created stay.`)) remove.mutate({ id: r.id }); }}><Trash2 />Delete</button></div></td>
      </tr>; })}</tbody>
    </table></div></div>
    <p className="panel-subtle renewal-help"><CalendarClock size={11} /> “Invoice & renew” drafts a normal invoice you can review and send from Invoices, then moves the renewal to the next {"cycle"}. Renewals due within {RENEWAL_NOTICE_DAYS} days also appear in the notifications bell.</p>
    <RenewalDialog open={Boolean(dialog)} initial={dialog || emptyForm()} clients={clients} saving={save.isPending} onClose={() => setDialog(null)} onSave={save_} />
  </div>;
}
