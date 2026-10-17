import { useEffect, useState } from "react";
import { Copy, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const copy = (value: string, label: string) => { navigator.clipboard?.writeText(value).then(() => toast.success(`${label} copied`)).catch(() => toast.error("Could not copy")); };

/** Settings -> Billing: automatic reminders, default hourly rate and exchange rates. */
export function BillingSettings({ isAdmin }: { isAdmin: boolean }) {
  const utils = trpc.useUtils();
  const profile = trpc.workspace.profile.useQuery();
  const [form, setForm] = useState({ remindersEnabled: false, defaultHourlyRate: "", USD: "", EUR: "", GBP: "" });
  useEffect(() => { if (profile.data) setForm({ remindersEnabled: profile.data.remindersEnabled, defaultHourlyRate: profile.data.defaultHourlyRate ? String(profile.data.defaultHourlyRate) : "", USD: String(profile.data.exchangeRates.USD || ""), EUR: String(profile.data.exchangeRates.EUR || ""), GBP: String(profile.data.exchangeRates.GBP || "") }); }, [profile.data]);
  const save = trpc.workspace.updateSettings.useMutation({ onSuccess: () => { toast.success("Billing settings saved"); utils.workspace.profile.invalidate(); }, onError: (error) => toast.error(error.message) });
  const rate = (value: string) => Number(value) > 0 ? Number(value) : undefined;
  if (profile.isLoading) return <div className="panel settings-card"><p className="panel-subtle">Loading…</p></div>;
  return <div className="panel settings-card">
    <h2>Billing</h2>
    <p>Payment reminders, time billing and foreign-currency invoices.</p>
    <div className="setting-switch-row"><div><strong>Automatic payment reminders</strong><span>Emails clients about sent, unpaid invoices: 3 days before the due date, on it, 7 days after, then every 14 days until paid. Each reminder is sent once and listed on the invoice.</span></div><input type="checkbox" checked={form.remindersEnabled} disabled={!isAdmin} aria-label="Automatic payment reminders" onChange={(e) => setForm({ ...form, remindersEnabled: e.target.checked })} /></div>
    {form.remindersEnabled && profile.data && !profile.data.emailConfigured ? <p className="panel-subtle settings-warning">Email delivery isn't set up on the server (RESEND_API_KEY and RESEND_FROM_EMAIL), so automatic reminders can't be sent yet. Manual reminders from an invoice still work.</p> : null}
    <div className="settings-fields">
      <label>Default hourly rate (KSh)<input type="number" min="0" value={form.defaultHourlyRate} disabled={!isAdmin} onChange={(e) => setForm({ ...form, defaultHourlyRate: e.target.value })} placeholder="Used when logging time" /></label>
      <label>KES per 1 USD<input type="number" min="0" step="any" value={form.USD} disabled={!isAdmin} onChange={(e) => setForm({ ...form, USD: e.target.value })} placeholder="e.g. 129.50" /></label>
      <label>KES per 1 EUR<input type="number" min="0" step="any" value={form.EUR} disabled={!isAdmin} onChange={(e) => setForm({ ...form, EUR: e.target.value })} /></label>
      <label>KES per 1 GBP<input type="number" min="0" step="any" value={form.GBP} disabled={!isAdmin} onChange={(e) => setForm({ ...form, GBP: e.target.value })} /></label>
    </div>
    <p className="panel-subtle">Exchange rates are the starting rate for new USD, EUR and GBP invoices and quotes; each document keeps its own rate. Dashboards and accounting stay in KES.</p>
    {isAdmin ? <button className="heading-action" disabled={save.isPending} onClick={() => save.mutate({ remindersEnabled: form.remindersEnabled, defaultHourlyRate: Math.max(0, Math.round(Number(form.defaultHourlyRate) || 0)), exchangeRates: { USD: rate(form.USD), EUR: rate(form.EUR), GBP: rate(form.GBP) } })}>{save.isPending ? "Saving…" : "Save billing settings"}</button> : <p className="panel-subtle">Only workspace admins can change billing settings.</p>}
  </div>;
}

/** Settings -> Integrations: the Daraja C2B callback URLs for automatic M-Pesa matching. */
export function MpesaIntegration({ isAdmin }: { isAdmin: boolean }) {
  const urls = trpc.workspace.mpesaWebhook.useQuery(undefined, { enabled: isAdmin });
  return <div className="panel settings-card">
    <h2><Smartphone size={14} /> M-Pesa (Safaricom Daraja)</h2>
    <p>Register these C2B URLs for your paybill or till in the Daraja portal. Each payment is recorded automatically and matched to the invoice whose number the client enters as the account number. Without Daraja, paste confirmation SMSes on the Payments page.</p>
    {!isAdmin ? <p className="panel-subtle">Only workspace admins can view integration URLs.</p> : urls.isLoading ? <p className="panel-subtle">Loading…</p> : urls.data ? <div className="settings-fields">
      <label className="wide">Confirmation URL<div className="contract-link-box"><span>{urls.data.confirmationUrl}</span><button className="text-button" type="button" onClick={() => copy(urls.data!.confirmationUrl, "Confirmation URL")}><Copy size={11} />Copy</button></div></label>
      <label className="wide">Validation URL<div className="contract-link-box"><span>{urls.data.validationUrl}</span><button className="text-button" type="button" onClick={() => copy(urls.data!.validationUrl, "Validation URL")}><Copy size={11} />Copy</button></div></label>
    </div> : <p className="panel-subtle">{urls.error?.message}</p>}
    <p className="panel-subtle">The URLs contain a private key: keep them out of public places.</p>
  </div>;
}
