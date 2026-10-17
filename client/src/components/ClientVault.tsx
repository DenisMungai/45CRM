import { useRef, useState } from "react";
import { Copy, Eye, EyeOff, FileDown, Globe, KeyRound, Link2, RefreshCw, Share2, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

const MAX_BYTES = 4 * 1024 * 1024;
const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
const copyText = (value: string, label: string) => { navigator.clipboard?.writeText(value).then(() => toast.success(`${label} copied`)).catch(() => toast.error("Could not copy")); };

/** Uploads one file to the vault (raw body; the server keeps it in the database). */
export async function uploadVaultFile(url: string, file: File) {
  if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 4 MB.`);
  const response = await fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/octet-stream", "X-File-Type": file.type || "application/octet-stream" }, body: file });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Upload failed (HTTP ${response.status}).`);
  return body as { id: string };
}

function PortalCard({ clientId, clientName, email, phone }: { clientId: string; clientName: string; email: string; phone: string }) {
  const utils = trpc.useUtils();
  const status = trpc.portal.status.useQuery({ clientId }, { retry: false });
  const set = trpc.portal.set.useMutation({ onSuccess: (result, input) => { utils.portal.status.setData({ clientId }, result); toast.success(input.action === "enable" ? "Client portal switched on" : input.action === "disable" ? "Client portal switched off" : "New portal link issued; the old link no longer works"); }, onError: (error) => toast.error(error.message) });
  const url = status.data?.url;
  const message = url ? `Hi ${clientName}, here's your project portal with your invoices, quotes, agreements, project progress and files: ${url}` : "";
  const digits = phone.replace(/[^\d]/g, "").replace(/^0/, "254");
  return <div className="panel vault-card">
    <div className="panel-head"><h2 className="panel-title"><Globe size={13} /> Client portal</h2>{status.data?.enabled ? <span className="status active">On</span> : <span className="status draft">Off</span>}</div>
    <div className="vault-body">
      {status.isLoading ? <p className="panel-subtle">Loading…</p> : status.isError ? <p className="panel-subtle">{status.error.message}</p> : status.data?.enabled && url ? <>
        <p className="panel-subtle">One private link where {clientName} sees sent invoices and quotes, agreements, project milestones to approve, shared files and renewals, and can send change requests or upload content.</p>
        <div className="contract-link-box"><Link2 size={12} /><span>{url}</span><button className="text-button" onClick={() => copyText(url, "Portal link")}><Copy size={11} />Copy</button></div>
        <div className="record-actions vault-actions">
          <a className="record-edit" href={url} target="_blank" rel="noreferrer"><Globe />Open portal</a>
          {email ? <a className="record-edit" href={`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent("Your project portal")}&body=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><Share2 />Email link</a> : null}
          {digits ? <a className="record-edit" href={`https://wa.me/${digits}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><Share2 />WhatsApp link</a> : null}
          <button className="record-edit" disabled={set.isPending} onClick={() => { if (window.confirm("Issue a new portal link? The current link stops working immediately.")) set.mutate({ clientId, action: "reset" }); }}><RefreshCw />New link</button>
          <button className="record-delete" disabled={set.isPending} onClick={() => set.mutate({ clientId, action: "disable" })}><X />Turn off</button>
        </div>
      </> : <>
        <p className="panel-subtle">Give {clientName} a private page with their invoices, quotes, agreements, project progress and shared files. Drafts and internal files stay private.</p>
        <button className="record-edit" disabled={set.isPending} onClick={() => set.mutate({ clientId, action: "enable" })}><Globe />Turn on client portal</button>
      </>}
    </div>
  </div>;
}

/** Client portal controls and the client's vault: files, links and logins. */
export default function ClientVault({ clientId, clientName, email, phone }: { clientId: string; clientName: string; email: string; phone: string }) {
  const utils = trpc.useUtils();
  const list = trpc.vault.list.useQuery({ clientId }, { retry: false });
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [form, setForm] = useState<{ kind: "link" | "credential"; name: string; url: string; username: string; secret: string; notes: string; visibility: "internal" | "client" } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [shareUploads, setShareUploads] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const refresh = () => utils.vault.list.invalidate({ clientId });
  const add = trpc.vault.add.useMutation({ onSuccess: () => { toast.success("Saved to the vault"); setForm(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const update = trpc.vault.update.useMutation({ onSuccess: () => refresh(), onError: (error) => toast.error(error.message) });
  const remove = trpc.vault.delete.useMutation({ onSuccess: () => { toast.success("Removed from the vault"); refresh(); }, onError: (error) => toast.error(error.message) });
  const reveal = trpc.vault.reveal.useMutation({ onSuccess: (result, input) => setRevealed((current) => ({ ...current, [input.id]: result.secret })), onError: (error) => toast.error(error.message) });
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let done = 0;
    for (const file of Array.from(files)) {
      try { await uploadVaultFile(`/api/vault/upload?clientId=${clientId}&name=${encodeURIComponent(file.name)}&visibility=${shareUploads ? "client" : "internal"}`, file); done++; }
      catch (error) { toast.error(error instanceof Error ? error.message : `Couldn't upload ${file.name}`); }
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = "";
    if (done) { toast.success(`${done} file${done === 1 ? "" : "s"} uploaded`); refresh(); }
  };
  const items = list.data || [];
  return <section className="vault-grid">
    <PortalCard clientId={clientId} clientName={clientName} email={email} phone={phone} />
    <div className="panel vault-card">
      <div className="panel-head"><h2 className="panel-title"><KeyRound size={13} /> Files, links &amp; logins</h2><span className="panel-subtle">{items.length} item{items.length === 1 ? "" : "s"}</span></div>
      <div className="vault-body">
        <div className="record-actions vault-actions">
          <label className="record-edit vault-upload"><input ref={fileInput} type="file" multiple disabled={uploading} onChange={(e) => upload(e.target.files)} /><Upload />{uploading ? "Uploading…" : "Upload files"}</label>
          <label className="checkbox-field vault-share"><input type="checkbox" checked={shareUploads} onChange={(e) => setShareUploads(e.target.checked)} />Share uploads in portal</label>
          <button className="record-edit" onClick={() => setForm({ kind: "link", name: "", url: "", username: "", secret: "", notes: "", visibility: "internal" })}><Link2 />Add link</button>
          <button className="record-edit" onClick={() => setForm({ kind: "credential", name: "", url: "", username: "", secret: "", notes: "", visibility: "internal" })}><KeyRound />Add login</button>
        </div>
        {form ? <div className="vault-form">
          <div className="record-fields">
            <label>{form.kind === "credential" ? "Login for" : "Name"}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={form.kind === "credential" ? "WordPress admin, cPanel, Google Analytics…" : "Brand guidelines, Figma file…"} maxLength={200} /></label>
            <label>URL<input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" /></label>
            {form.kind === "credential" ? <><label>Username / email<input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoComplete="off" /></label><label>Password<input type="password" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} autoComplete="new-password" /></label></> : <label className="checkbox-field"><input type="checkbox" checked={form.visibility === "client"} onChange={(e) => setForm({ ...form, visibility: e.target.checked ? "client" : "internal" })} />Show in client portal</label>}
            <label className="wide">Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} maxLength={2000} /></label>
          </div>
          {form.kind === "credential" ? <p className="panel-subtle">Passwords are encrypted, never shown in the client portal, and every time someone reveals one it's recorded in the activity log.</p> : null}
          <div className="record-dialog-actions"><button className="record-reset" onClick={() => setForm(null)}>Cancel</button><button className="record-save" disabled={!form.name.trim() || add.isPending} onClick={() => add.mutate({ clientId, kind: form.kind, name: form.name, url: form.url || null, username: form.username || null, secret: form.secret || null, notes: form.notes || null, visibility: form.visibility })}>Save</button></div>
        </div> : null}
        {list.isLoading ? <p className="panel-subtle">Loading…</p> : list.isError ? <p className="panel-subtle">{list.error.message}</p> : items.length === 0 ? <p className="activity-empty">Nothing stored yet. Keep brand files, content, hosting and CMS logins for {clientName} here.</p> : <div className="vault-list">{items.map((item) => <div className="vault-item" key={item.id}>
          <div className="vault-icon">{item.kind === "credential" ? <KeyRound /> : item.kind === "link" ? <Link2 /> : <FileDown />}</div>
          <div className="vault-main">
            <strong>{item.name}</strong>
            <small>{item.kind === "file" ? `${size(item.sizeBytes)}${item.source === "client" ? " · uploaded by client" : ""}` : item.url || ""}{item.username ? ` · ${item.username}` : ""}{item.notes ? ` · ${item.notes}` : ""}</small>
            {item.kind === "credential" && revealed[item.id] !== undefined ? <code className="vault-secret">{revealed[item.id]}</code> : null}
          </div>
          <div className="record-actions">
            {item.kind === "file" ? <a className="record-edit" href={`/api/vault/files/${item.id}?download=1`}><FileDown />Download</a> : null}
            {item.kind === "link" && item.url ? <a className="record-edit" href={item.url} target="_blank" rel="noreferrer"><Link2 />Open</a> : null}
            {item.kind === "credential" && item.hasSecret ? revealed[item.id] !== undefined ? <><button className="record-edit" onClick={() => copyText(revealed[item.id], "Password")}><Copy />Copy</button><button className="record-edit" onClick={() => setRevealed(({ [item.id]: _hidden, ...rest }) => rest)}><EyeOff />Hide</button></> : <button className="record-edit" disabled={reveal.isPending} onClick={() => reveal.mutate({ id: item.id })}><Eye />Reveal</button> : null}
            {item.kind !== "credential" ? <button className={`record-edit ${item.visibility === "client" ? "is-on" : ""}`} title={item.visibility === "client" ? "Shown in the client portal - click to make internal" : "Internal - click to show in the client portal"} onClick={() => update.mutate({ id: item.id, visibility: item.visibility === "client" ? "internal" : "client" })}><Share2 />{item.visibility === "client" ? "Shared" : "Internal"}</button> : null}
            <button className="record-delete" aria-label={`Delete ${item.name}`} onClick={() => { if (window.confirm(`Delete ${item.name} from the vault?`)) remove.mutate({ id: item.id }); }}><Trash2 /></button>
          </div>
        </div>)}</div>}
      </div>
    </div>
  </section>;
}
