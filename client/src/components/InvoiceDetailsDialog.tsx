import { useEffect, useState } from "react";
import { Check, Plus, Trash2, X } from "lucide-react";
import { CURRENCIES, DEPOSIT_METHODS, MPESA_CODE_PATTERN, computeInvoiceTotals, formatInvoiceMoney, normaliseMpesaCode, type Currency, type InvoiceDeposit, type InvoiceFields } from "@shared/invoice";

type Row = { description: string; quantity: string; unitPrice: string };
type Form = Omit<InvoiceFields, "items" | "discount" | "exchangeRate"> & { items: Row[]; discount: string; exchangeRate: string };

const toForm = (f: InvoiceFields): Form => ({ ...f, currency: f.currency || "KES", exchangeRate: String(f.exchangeRate || 1), discount: f.discount ? String(f.discount) : "", items: f.items.map((i) => ({ description: i.description, quantity: String(i.quantity), unitPrice: i.unitPrice ? String(i.unitPrice) : "" })) });
const toFields = (f: Form): InvoiceFields => ({ ...f, exchangeRate: f.currency === "KES" ? 1 : Number(f.exchangeRate) || 0, discount: Number(f.discount) || 0, items: f.items.filter((i) => i.description.trim()).map((i) => ({ description: i.description.trim(), quantity: Number(i.quantity) || 0, unitPrice: Number(i.unitPrice) || 0 })) });

export type InvoiceMeta = { number: string; issueDate: string; dueDate: string };
type DepositForm = { amount: string; method: InvoiceDeposit["method"]; reference: string; paidAt: string };
const emptyDeposit = (): DepositForm => ({ amount: "", method: "M-Pesa", reference: "", paidAt: new Date().toLocaleDateString("en-CA") });
export type ClientOption = { name: string; email: string; phone: string };

/** Editor for an invoice, or a quotation when `kind` is "quote" (no payment instructions; "valid until" instead of due date). */
export default function InvoiceDetailsDialog({ open, number, initial, saving, onClose, onSubmit, initialMeta, clients = [], creating = true, kind = "invoice", rates = {} }: { open: boolean; number: string; initial: InvoiceFields; saving: boolean; onClose: () => void; onSubmit: (fields: InvoiceFields, meta?: InvoiceMeta, deposit?: InvoiceDeposit) => void; initialMeta?: InvoiceMeta; clients?: ClientOption[]; creating?: boolean; kind?: "invoice" | "quote"; rates?: Record<string, number> }) {
  const isQuote = kind === "quote";
  const [meta, setMeta] = useState<InvoiceMeta | undefined>(initialMeta);
  const [form, setForm] = useState<Form>(() => toForm(initial));
  const [deposit, setDeposit] = useState<DepositForm>(emptyDeposit);
  // Reset only when the dialog opens; the parent may pass fresh object literals on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) { setForm(toForm(initial)); setMeta(initialMeta); setDeposit(emptyDeposit()); } }, [open]);
  if (!open) return null;
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((c) => ({ ...c, [key]: value }));
  const setRow = (index: number, patch: Partial<Row>) => setForm((c) => ({ ...c, items: c.items.map((r, i) => i === index ? { ...r, ...patch } : r) }));
  const fields = toFields(form);
  const totals = computeInvoiceTotals(fields.items, fields.discount);
  // A deposit is keyed in only when creating an invoice; later payments go through the invoice popup.
  const takesDeposit = creating && !isQuote;
  const depositKes = takesDeposit ? Math.max(0, Math.round(Number(deposit.amount) || 0)) : 0;
  const rate = form.currency === "KES" ? 1 : Number(form.exchangeRate) || 1;
  const amountDue = Math.max(0, totals.total - depositKes / rate);
  const depositCode = normaliseMpesaCode(deposit.reference);
  const depositProblem = !depositKes ? "" : deposit.method === "M-Pesa" && depositCode && !MPESA_CODE_PATTERN.test(depositCode) ? "M-Pesa codes are 10 letters and numbers, e.g. SJK3H2L9QX." : depositKes / rate > totals.total ? "The deposit cannot be more than the invoice total." : "";
  const depositInput: InvoiceDeposit | undefined = depositKes ? { amount: depositKes, method: deposit.method, reference: deposit.method === "M-Pesa" ? depositCode : deposit.reference.trim(), paidAt: deposit.paidAt } : undefined;
  const problem = depositProblem || form.currency !== "KES" && !(Number(form.exchangeRate) > 0) ? `Enter how many KES one ${form.currency} is worth.` : meta && meta.dueDate < meta.issueDate ? `The ${isQuote ? "valid-until" : "due"} date cannot be before the issue date.` : !form.clientName.trim() ? "Add the client or company name." : !fields.items.length || fields.items.some((i) => i.quantity <= 0) ? "Add at least one line with a quantity above zero." : Number(form.discount) > totals.subtotal ? "The discount cannot be more than the subtotal." : "";
  const text = (label: string, key: keyof Form, props: { wide?: boolean; type?: string; placeholder?: string } = {}) =>
    <label className={props.wide ? "wide" : undefined}>{label}<input type={props.type || "text"} placeholder={props.placeholder} value={form[key] as string} onChange={(e) => set(key, e.target.value as never)} /></label>;
  return <div className="record-dialog-backdrop" role="presentation" onMouseDown={(e) => { e.stopPropagation(); onClose(); }}>
    <section className="record-dialog panel contract-dialog" role="dialog" aria-modal="true" aria-labelledby="inv-form-title" onMouseDown={(e) => e.stopPropagation()}>
      <div className="record-dialog-head"><div><span className="eyebrow">{number}</span><h2 id="inv-form-title">{isQuote ? (creating ? "New quotation" : "Quotation details") : creating ? "New invoice" : "Invoice details"}</h2></div><button className="record-close" aria-label="Close" onClick={onClose}><X /></button></div>
      <div className="contract-form-sections">
        {meta ? <fieldset><legend>{isQuote ? "Quotation" : "Invoice"}</legend><div className="record-fields">
          <label>{isQuote ? "Quote" : "Invoice"} number<input value={meta.number} readOnly title={creating ? "Assigned automatically when it is created" : "Numbers cannot be changed"} /></label>
          <label>Issue date<input type="date" value={meta.issueDate} onChange={(e) => setMeta({ ...meta, issueDate: e.target.value })} /></label>
          <label>{isQuote ? "Valid until" : "Due date"}<input type="date" value={meta.dueDate} onChange={(e) => setMeta({ ...meta, dueDate: e.target.value })} /></label>
        </div></fieldset> : null}
        <fieldset><legend>Currency</legend><div className="record-fields">
          <label>Currency<select value={form.currency} onChange={(e) => { const currency = e.target.value as Currency; setForm((c) => ({ ...c, currency, exchangeRate: currency === "KES" ? "1" : String(rates[currency] || (c.currency === currency ? c.exchangeRate : "")) })); }}>{CURRENCIES.map((code) => <option key={code} value={code}>{code === "KES" ? "KES - Kenyan shilling" : code}</option>)}</select></label>
          {form.currency !== "KES" ? <label>KES per 1 {form.currency}<input type="number" min="0" step="any" value={form.exchangeRate} onChange={(e) => set("exchangeRate", e.target.value)} placeholder="e.g. 129.50" /></label> : null}
        </div>{form.currency !== "KES" ? <p className="panel-subtle">Amounts below are in {form.currency}. Payments are recorded in KES and converted at this rate; dashboards and accounting stay in KES.</p> : null}</fieldset>
        <fieldset><legend>{isQuote ? "Prepared for" : "Bill to"}</legend><div className="record-fields">
          {clients.length ? <label className="wide">Select client<select value="" onChange={(e) => { const c = clients.find((x) => x.name === e.target.value); if (c) setForm((f) => ({ ...f, clientName: c.name, clientEmail: c.email, clientPhone: c.phone })); }}><option value="">Enter manually</option>{clients.filter((c, i) => c.name && clients.findIndex((x) => x.name === c.name) === i).map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}</select></label> : null}
          {text("Client / Company", "clientName")}{text("Contact person", "contactPerson")}{text("Email", "clientEmail", { type: "email" })}{text("Phone (WhatsApp)", "clientPhone", { placeholder: "+254 7XX XXX XXX" })}{text("Billing address", "billingAddress", { wide: true, placeholder: "Address / Town / County" })}
        </div></fieldset>
        <fieldset><legend>Project details</legend><div className="record-fields">
          {text("Project", "projectName")}{text("Quotation / contract ref", "quotationRef")}{text("Scope", "scope", { wide: true, placeholder: "Brief description of agreed work" })}{text("Payment terms", "paymentTerms", { wide: true, placeholder: isQuote ? "50% deposit before work begins; balance due before launch or handover." : "Balance due before launch or handover." })}
          <label>Project milestone<input list="inv-milestones" value={form.milestone} onChange={(e) => set("milestone", e.target.value)} /><datalist id="inv-milestones"><option value="Deposit" /><option value="Milestone" /><option value="Final balance" /></datalist></label>
        </div></fieldset>
        <fieldset><legend>Itemized services</legend>
          <div className="inv-edit-items">
            <div className="inv-edit-row inv-edit-head"><span>Description</span><span>Qty</span><span>Unit price ({form.currency === "KES" ? "KSh" : form.currency})</span><span>Amount</span><span /></div>
            {form.items.map((row, index) => <div className="inv-edit-row" key={index}>
              <input aria-label={`Line ${index + 1} description`} value={row.description} onChange={(e) => setRow(index, { description: e.target.value })} placeholder="Website development / CMS setup" />
              <input aria-label="Quantity" type="number" min="0" step="any" value={row.quantity} onChange={(e) => setRow(index, { quantity: e.target.value })} />
              <input aria-label="Unit price" type="number" min="0" value={row.unitPrice} onChange={(e) => setRow(index, { unitPrice: e.target.value })} />
              <span className="inv-edit-amount">{formatInvoiceMoney(Math.round((Number(row.quantity) || 0) * (Number(row.unitPrice) || 0)), form.currency).split(" ")[1]}</span>
              <button type="button" className="inv-edit-remove" aria-label={`Remove line ${index + 1}`} disabled={form.items.length === 1} onClick={() => setForm((c) => ({ ...c, items: c.items.filter((_, i) => i !== index) }))}><Trash2 /></button>
            </div>)}
          </div>
          <div className="inv-edit-foot">
            <button type="button" className="text-button" onClick={() => setForm((c) => ({ ...c, items: [...c.items, { description: "", quantity: "1", unitPrice: "" }] }))}><Plus size={11} /> Add line</button>
            <label>Discount ({form.currency === "KES" ? "KSh" : form.currency})<input type="number" min="0" value={form.discount} onChange={(e) => set("discount", e.target.value)} /></label>
            <strong>Total {formatInvoiceMoney(totals.total, form.currency)}</strong>
          </div>
          <p className="panel-subtle">Lines without a unit price are left off the invoice.</p>
        </fieldset>
        {takesDeposit ? <fieldset><legend>Deposit paid</legend><div className="record-fields">
          <label>Deposit paid (KSh)<input type="number" min="0" value={deposit.amount} onChange={(e) => setDeposit({ ...deposit, amount: e.target.value })} placeholder="0" /></label>
          <label>Paid by<select value={deposit.method} onChange={(e) => setDeposit({ ...deposit, method: e.target.value as InvoiceDeposit["method"] })}>{DEPOSIT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></label>
          <label>{deposit.method === "M-Pesa" ? "M-Pesa code" : "Reference (optional)"}<input value={deposit.reference} onChange={(e) => setDeposit({ ...deposit, reference: deposit.method === "M-Pesa" ? e.target.value.toUpperCase() : e.target.value })} placeholder={deposit.method === "M-Pesa" ? "SJK3H2L9QX" : deposit.method === "Bank" ? "Bank transaction ref" : "Receipt no."} /></label>
          <label>Date paid<input type="date" value={deposit.paidAt} onChange={(e) => setDeposit({ ...deposit, paidAt: e.target.value })} /></label>
        </div>
        <dl className="inv-edit-due"><div><dt>Total</dt><dd>{formatInvoiceMoney(totals.total, form.currency)}</dd></div><div><dt>Deposit paid</dt><dd>{`– ${formatInvoiceMoney(depositKes / rate, form.currency)}`}</dd></div><div><dt>Amount due</dt><dd>{formatInvoiceMoney(amountDue, form.currency)}</dd></div></dl>
        <p className="panel-subtle">Leave it empty if nothing has been paid yet. The deposit is recorded as a payment on this invoice{form.currency !== "KES" ? ", in KES at the rate above" : ""}. Later payments are added from the invoice itself.</p></fieldset> : null}
        {isQuote ? null : <fieldset><legend>Payment instructions</legend><div className="record-fields">
          {text("M-Pesa Paybill / Till number", "mpesaNumber")}{text("M-Pesa account", "mpesaAccount", { placeholder: "Defaults to the invoice number" })}{text("M-Pesa phone number (Send Money / Pochi)", "pochiNumber", { placeholder: "07XX XXX XXX" })}{text("Name registered on that number", "pochiName", { placeholder: "Name shown in M-Pesa" })}{text("Bank name", "bankName")}{text("Bank account name", "bankAccountName")}{text("Bank account number", "bankAccountNumber")}{text("Send confirmation to", "confirmationContact", { placeholder: "WhatsApp / email" })}{text("Website (footer)", "businessWebsite")}
        </div></fieldset>}
        <fieldset><legend>Notes / special instructions</legend><textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Shown at the end of the document" /></fieldset>
      </div>
      {problem ? <p className="panel-subtle" role="alert">{problem}</p> : null}
      <div className="record-dialog-actions"><button className="record-reset" onClick={onClose}>Cancel</button><button className="record-save" disabled={saving || Boolean(problem)} onClick={() => onSubmit(fields, meta, depositInput)}><Check />{saving ? "Saving…" : isQuote ? (creating ? "Create quotation" : "Save quotation") : creating ? "Create invoice" : "Save invoice details"}</button></div>
    </section>
  </div>;
}
