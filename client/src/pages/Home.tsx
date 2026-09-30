/**
 * Midnight Ledger design reminder: this reference-led operations console uses a fixed
 * graphite rail, dense business information, quiet depth, and oxide-red only as a signal.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { trpc } from "@/lib/trpc";
import { downloadBase64Pdf } from "@/lib/utils";
import DashboardProfileCard, { buildProfileUpdateInput, notifyProfileMutation } from "@/components/DashboardProfileCard";
import SignaturePad from "@/components/SignaturePad";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { toast } from "sonner";
import {
  Activity, Archive, ArrowDownRight, ArrowLeft, ArrowUpRight, Bell, Bot, BookOpen,
  Box, BriefcaseBusiness, Building2, CalendarDays, Check, CheckCircle2, ChevronRight,
  CircleAlert, CircleDollarSign, ClipboardList, Copy, CreditCard, Database, Eraser, ExternalLink, FileBarChart,
  FileDown, FileSignature, FileText, FolderKanban, HardDrive, Headphones, Landmark, Lightbulb,
  LayoutDashboard, Mail, MessageCircle, Package, Pencil, PenTool, Phone, Plus, ReceiptText, RefreshCw, Search, Send,
  Settings, ShieldCheck, SlidersHorizontal, Sparkles, TrendingDown, TrendingUp, UserRound, Users,
  Trash2, Undo2, WalletCards, Warehouse, X, History, Webhook, Globe,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ContractFields } from "@shared/contract";

type PageKey = "Dashboard" | "Clients" | "Leads" | "Projects" | "Quotes" | "Invoices" | "Payments" | "Inventory" | "Accounting" | "Contracts" | "Reports" | "AI Assistant" | "Settings" | "Client Details" | "Invoice Details";
type StatusTone = "active" | "paid" | "completed" | "accepted" | "overdue" | "expired" | "negative" | "pending" | "draft" | "new" | "sent" | "in-progress" | "proposal";
type EditableRow = string[];
type EditorState = { title: string; labels: string[]; row: EditableRow; onSave: (next: EditableRow) => void };
type DeletedRecord = { id: string; label: string; table: string; row: EditableRow; index: number; deletedAt: number };
type ActivityEvent = { id: string; recordId: string; label: string; table: string; action: string; detail: string; at: number; synced?: boolean };

const logo = "/assets/45creatives-logo.png";
const nadia = "/assets/avatar-nadia.svg";
const john = "/assets/avatar-john.svg";

const navItems: { label: Exclude<PageKey, "Client Details" | "Invoice Details">; icon: typeof LayoutDashboard }[] = [
  { label: "Dashboard", icon: LayoutDashboard }, { label: "Clients", icon: Users }, { label: "Leads", icon: UserRound },
  { label: "Projects", icon: FolderKanban }, { label: "Quotes", icon: FileText }, { label: "Invoices", icon: ReceiptText },
  { label: "Payments", icon: WalletCards }, { label: "Inventory", icon: Package }, { label: "Accounting", icon: BookOpen },
  { label: "Contracts", icon: FileSignature },
  { label: "Reports", icon: Activity }, { label: "AI Assistant", icon: Sparkles }, { label: "Settings", icon: Settings },
];

const knownPages = new Set<PageKey>([...navItems.map((item) => item.label), "Client Details", "Invoice Details"]);

// All workspace records are loaded from the shared database (records.list / records.sync).
// A fresh workspace has no records, so every table starts empty - no seed/demo rows.
const emptyRows: readonly (readonly (string | number)[])[] = [];

/** Parses a free-text amount cell (e.g. "KSh 25,000", "25000") into a number. Returns 0 if unparseable. */
function parseAmount(value: string | undefined): number {
  if (!value) return 0;
  const cleaned = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return cleaned ? Number(cleaned[0]) : 0;
}

/** Formats a number as a Kenyan shilling amount, e.g. 25000 -> "KSh 25,000". */
function formatKsh(value: number): string {
  return `KSh ${Math.round(value).toLocaleString("en-KE")}`;
}

/** Parses a free-text date cell into a Date, or null if unparseable. Handles the app's own
 * en-KE "dd/mm/yyyy" display format explicitly first - the native Date constructor misreads
 * that as mm/dd/yyyy (or fails outright once the day exceeds 12), which was silently corrupting
 * every month-to-date calculation for transactions dated after the 12th of the month. */
function parseRowDate(value: string | undefined): Date | null {
  if (!value) return null;
  const dmy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const day = Number(dmy[1]), month = Number(dmy[2]), year = Number(dmy[3]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      const parsed = new Date(year, month - 1, day);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Builds { m: "Jan", revenue, expense } monthly buckets from transaction rows for the last N months. */
function monthlySeriesFromTransactions(rows: EditableRow[], months: number) {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (months - 1 - index), 1);
    return { key: `${date.getFullYear()}-${date.getMonth()}`, m: date.toLocaleDateString("en-US", { month: "short" }), revenue: 0, expense: 0 };
  });
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  rows.forEach((row) => {
    const date = parseRowDate(row[0]);
    if (!date) return;
    const bucket = byKey.get(`${date.getFullYear()}-${date.getMonth()}`);
    if (!bucket) return;
    const amount = parseAmount(row[4]) / 1000;
    if (row[5] === "positive") bucket.revenue += amount; else bucket.expense += amount;
  });
  return buckets;
}

/** Sums this-month and last-month income/expense from transaction rows, for MTD metrics and trend comparisons. */
function monthlyIncomeExpense(rows: EditableRow[]) {
  const now = new Date();
  const last = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const isThisMonth = (row: EditableRow) => { const date = parseRowDate(row[0]); return date ? date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() : false; };
  const isLastMonth = (row: EditableRow) => { const date = parseRowDate(row[0]); return date ? date.getFullYear() === last.getFullYear() && date.getMonth() === last.getMonth() : false; };
  const sum = (predicate: (row: EditableRow) => boolean) => rows.filter(predicate).reduce((total, row) => total + parseAmount(row[4]), 0);
  return {
    mtdIncome: sum((row) => row[5] === "positive" && isThisMonth(row)),
    mtdExpense: sum((row) => row[5] === "negative" && isThisMonth(row)),
    lastMonthIncome: sum((row) => row[5] === "positive" && isLastMonth(row)),
    lastMonthExpense: sum((row) => row[5] === "negative" && isLastMonth(row)),
  };
}

const recordMarker = "__4s_record_id:";
function isRecordId(value: string | undefined) { return Boolean(value?.startsWith(recordMarker)); }
function getRecordId(row: EditableRow) { const candidate = row[row.length - 1]; return isRecordId(candidate) ? candidate.slice(recordMarker.length) : ""; }
function createRecordId(_key: string) { return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`; }
function ensureRecordIds(key: string, rows: EditableRow[]) { return rows.map((row) => isRecordId(row[row.length - 1]) ? row : [...row, `${recordMarker}${createRecordId(key)}`]); }
function cloneRows(key: string, rows: readonly (readonly (string | number)[])[]): EditableRow[] { return ensureRecordIds(key, rows.map((row) => row.map(String))); }

function useStoredRows(key: string, defaults: readonly (readonly (string | number)[])[]) {
  const [rows, setRows] = useState<EditableRow[]>(() => cloneRows(key, defaults));
  const setRowsWithIds: Dispatch<SetStateAction<EditableRow[]>> = (next) => setRows((current) => ensureRecordIds(key, typeof next === "function" ? next(current) : next));
  return [rows, setRowsWithIds] as const;
}

function useStoredDeletedRecords(key: string) {
  const [records, setRecords] = useState<DeletedRecord[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = window.localStorage.getItem(key);
      const parsed = saved ? JSON.parse(saved) : [];
      const cutoff = Date.now() - 1000 * 60 * 60;
      return Array.isArray(parsed) ? parsed.filter((record) => record && Array.isArray(record.row) && typeof record.deletedAt === "number" && record.deletedAt > cutoff).slice(0, 8) : [];
    } catch { return []; }
  });
  useEffect(() => { window.localStorage.setItem(key, JSON.stringify(records)); }, [key, records]);
  return [records, setRecords] as const;
}

function useStoredActivity(key: string) {
  const [events, setEvents] = useState<ActivityEvent[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed.filter((event) => event && typeof event.label === "string" && typeof event.at === "number").map((event) => ({ ...event, recordId: typeof event.recordId === "string" ? event.recordId : `${event.table || "workspace"}:${event.label}` })).slice(0, 200) : [];
    } catch { return []; }
  });
  useEffect(() => { window.localStorage.setItem(key, JSON.stringify(events)); }, [events, key]);
  return [events, setEvents] as const;
}

function updateStoredRow(setRows: Dispatch<SetStateAction<EditableRow[]>>, index: number, nextRow: EditableRow) { setRows((previous) => previous.map((row, rowIndex) => rowIndex === index ? [...nextRow.filter((value) => !isRecordId(value)), row[row.length - 1]].filter(Boolean) : row)); }

function statusTone(value: string): StatusTone {
  const normalized = value.toLowerCase();
  if (normalized.includes("paid")) return "paid";
  if (normalized.includes("complete")) return "completed";
  if (normalized.includes("accept")) return "accepted";
  if (normalized.includes("overdue") || normalized.includes("out of stock") || normalized.includes("expense")) return "overdue";
  if (normalized.includes("expired")) return "expired";
  if (normalized.includes("pending") || normalized.includes("low stock") || normalized.includes("nurturing")) return "pending";
  if (normalized.includes("draft")) return "draft";
  if (normalized.includes("new")) return "new";
  if (normalized.includes("sent") || normalized.includes("contacted") || normalized.includes("configured")) return "sent";
  if (normalized.includes("progress")) return "in-progress";
  if (normalized.includes("proposal")) return "proposal";
  return "active";
}

function useTableDiscovery(rows: EditableRow[], filterIndex: number, externalQuery = "") {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [page, setPage] = useState(1);
  const options = useMemo(() => ["All", ...Array.from(new Set(rows.map((row) => row[filterIndex]).filter(Boolean)))], [filterIndex, rows]);
  const filteredRows = useMemo(() => rows.map((row, index) => ({ row, index })).filter(({ row }) => {
    const query = `${search} ${externalQuery}`.trim().toLowerCase();
    return (!query || row.join(" ").toLowerCase().includes(query)) && (filter === "All" || row[filterIndex] === filter);
  }), [externalQuery, filter, filterIndex, rows, search]);
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / 5));
  useEffect(() => { setPage((current) => Math.min(current, totalPages)); }, [totalPages]);
  useEffect(() => { setPage(1); }, [filter, search, externalQuery]);
  const visibleRows = useMemo(() => filteredRows.slice((page - 1) * 5, page * 5), [filteredRows, page]);
  return { search, setSearch, filter, setFilter, options, visibleRows, page, setPage, totalPages, filteredCount: filteredRows.length };
}

function TableDiscovery({ placeholder, search, onSearch, filter, onFilter, options, countLabel }: { placeholder: string; search: string; onSearch: (value: string) => void; filter: string; onFilter: (value: string) => void; options: string[]; countLabel: string }) {
  return <div className="filterbar table-discovery"><label className="searchbox"><Search /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} aria-label={placeholder} /></label><label className="table-filter"><SlidersHorizontal /><select value={filter} onChange={(event) => onFilter(event.target.value)} aria-label="Filter table records">{options.map((option) => <option key={option}>{option}</option>)}</select></label><span className="panel-subtle">{countLabel}</span></div>;
}

function useBulkSelection() {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggle = (index: number) => setSelected((current) => { const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next; });
  const toggleAll = (indices: number[]) => setSelected((current) => { const allSelected = indices.length > 0 && indices.every((index) => current.has(index)); if (allSelected) return new Set(Array.from(current).filter((index) => !indices.includes(index))); return new Set(Array.from(current).concat(indices)); });
  return { selected, toggle, toggleAll, clear: () => setSelected(new Set()) };
}

function TableCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) { return <input className="table-checkbox" type="checkbox" checked={checked} onChange={onChange} onClick={(event) => event.stopPropagation()} aria-label={label} />; }

function csvCell(value: string) { return `"${value.replace(/"/g, '""')}"`; }
function parseCsv(text: string) { const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean); return lines.slice(1).map((line) => Array.from(line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^",]*))/g)).map((match) => (match[1] ?? match[2] ?? "").replace(/""/g, '"'))).filter((row) => row.some(Boolean)); }

function BulkActions({ selectedCount, options, onEdit, onDelete, onClear }: { selectedCount: number; options: string[]; onEdit: (value: string) => void; onDelete: () => void; onClear: () => void }) {
  const [value, setValue] = useState("");
  const [importing, setImporting] = useState(false);
  useEffect(() => { if (value && !options.includes(value)) setValue(""); }, [options, value]);
  const exportSelected = (event: React.MouseEvent<HTMLButtonElement>) => { const page = event.currentTarget.closest(".page-content"); const table = page?.querySelector<HTMLTableElement>(".data-table"); if (!table) return; const headers = Array.from(table.querySelectorAll("thead th")).slice(1, -1).map((cell) => cell.textContent?.trim() || ""); const rows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => row.querySelector<HTMLInputElement>(".table-checkbox")?.checked).map((row) => Array.from(row.querySelectorAll("td")).slice(1, -1).map((cell) => cell.textContent?.trim() || "")); const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"); const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${page?.querySelector("h1")?.textContent?.toLowerCase().replace(/\s+/g, "-") || "records"}-selected.csv`; anchor.click(); URL.revokeObjectURL(url); toast.success(`${rows.length} selected rows exported`); };
  const importCsv = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; const page = event.currentTarget.closest(".page-content"); if (!file || !page) return; const reader = new FileReader(); reader.onload = () => { const rows = parseCsv(String(reader.result || "")); window.dispatchEvent(new CustomEvent("4s-csv-import", { detail: { page: page.querySelector("h1")?.textContent || "", rows } })); toast.success(`${rows.length} CSV rows imported`); setImporting(false); }; reader.readAsText(file); };
  if (!selectedCount) return <div className="csv-utility"><label className="bulk-import"><input type="file" accept=".csv,text/csv" onChange={importCsv} onClick={() => setImporting(true)} /><FileText />{importing ? "Choose CSV" : "Import CSV"}</label><span>Import rows into this table from a matching CSV header.</span></div>;
  return <div className="bulk-actions"><div><strong>{selectedCount} selected</strong><button onClick={onClear}>Clear</button></div><label><span>Bulk status</span><select value={value} onChange={(event) => setValue(event.target.value)}><option value="">Choose status…</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label><button className="bulk-apply" disabled={!value} onClick={() => { onEdit(value); setValue(""); }}><Check />Apply</button><button className="bulk-export" onClick={exportSelected}><FileDown />Export CSV</button><label className="bulk-import"><input type="file" accept=".csv,text/csv" onChange={importCsv} onClick={() => setImporting(true)} /><FileText />{importing ? "Choose CSV" : "Import CSV"}</label><button className="bulk-delete" onClick={onDelete}><Trash2 />Delete selected</button></div>;
}

function EditRecordButton({ onClick }: { onClick: () => void }) { return <button className="record-edit" aria-label="Edit record" onClick={(event) => { event.stopPropagation(); onClick(); }}><Pencil />Edit</button>; }

function RecordActions({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) { const { user } = useAuth(); const openHistory = (event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); const row = event.currentTarget.closest("tr"); const cells = row?.querySelectorAll("td"); const page = event.currentTarget.closest(".page-content")?.querySelector("h1")?.textContent; const label = (page === "Accounting" ? cells?.[2] : cells?.[1])?.textContent?.trim() || row?.textContent?.trim() || "Record"; window.dispatchEvent(new CustomEvent("4s-record-history", { detail: { label } })); }; return <div className="record-actions"><EditRecordButton onClick={onEdit} />{user?.role === "admin" ? <button className="record-history" aria-label="View record activity" onClick={openHistory}><History />History</button> : null}<button className="record-delete" aria-label="Delete record" onClick={(event) => { event.stopPropagation(); onDelete(); }}><Trash2 />Delete</button></div>; }

function ActivityHistoryDialog({ label, events, onClose }: { label: string | null; events: ActivityEvent[]; onClose: () => void }) { if (!label) return null; const history = events.filter((event) => event.label === label); const download = () => { const csv = [["Record", "Action", "Detail", "Timestamp"], ...history.map((event) => [label, event.action, event.detail, new Date(event.at).toISOString()])].map((row) => row.map(csvCell).join(",")).join("\n"); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${label.toLowerCase().replace(/\s+/g, "-")}-activity.csv`; anchor.click(); URL.revokeObjectURL(url); }; return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}><section className="record-dialog panel activity-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-history-title" onMouseDown={(event) => event.stopPropagation()}><div className="record-dialog-head"><div><span className="eyebrow">Per-record audit trail</span><h2 id="activity-history-title">{label}</h2></div><div className="activity-actions"><button onClick={download} className="record-history"><FileDown />Download CSV</button><button className="record-close" aria-label="Close history" onClick={onClose}><X /></button></div></div><div className="activity-timeline">{history.length ? history.map((event) => <div className="activity-event" key={event.id}><i /><div><strong>{event.action}</strong><p>{event.detail}</p><span>{new Date(event.at).toLocaleString()}</span></div></div>) : <p className="activity-empty">No recorded changes yet. New edits, deletions, restores, bulk changes, and imports are captured here.</p>}</div></section></div>; }

function RecoveryTray({ records, onUndo, onDismiss }: { records: DeletedRecord[]; onUndo: (record: DeletedRecord) => void; onDismiss: (id: string) => void }) {
  if (!records.length) return null;
  const latest = records[0];
  return <aside className="recovery-tray" aria-live="polite"><div className="recovery-icon"><Trash2 /></div><div><span>Recently deleted</span><strong>{latest.label}</strong><p>{records.length > 1 ? `${records.length - 1} more record${records.length > 2 ? "s" : ""} available` : "Recover it anytime in this session"}</p></div><button className="recovery-undo" onClick={() => onUndo(latest)}><Undo2 />Undo</button><button className="recovery-dismiss" aria-label="Dismiss deleted record" onClick={() => onDismiss(latest.id)}><X /></button></aside>;
}

function RecordEditor({ editor, onClose }: { editor: EditorState | null; onClose: () => void }) {
  const [draft, setDraft] = useState<EditableRow>([]);
  useEffect(() => { setDraft(editor ? [...editor.row] : []); }, [editor]);
  if (!editor) return null;
  const creating = editor.title.toLowerCase().startsWith("new ");
  const recordName = creating ? editor.title.replace(/^new\s+/i, "") : editor.title;
  return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}><section className="record-dialog panel" role="dialog" aria-modal="true" aria-labelledby="record-editor-title" onMouseDown={(event) => event.stopPropagation()}><div className="record-dialog-head"><div><span className="eyebrow">Workspace record</span><h2 id="record-editor-title">{creating ? `Create ${recordName}` : `Edit ${recordName}`}</h2></div><button className="record-close" aria-label="Close editor" onClick={onClose}><X /></button></div><div className="record-fields">{editor.labels.map((label, index) => <label key={label}>{label}<input value={draft[index] ?? ""} onChange={(event) => setDraft((current) => current.map((cell, cellIndex) => cellIndex === index ? event.target.value : cell))} /></label>)}</div><div className="record-dialog-actions"><button className="record-reset" onClick={onClose}>Cancel</button><button className="record-save" onClick={() => { editor.onSave(draft); toast.success(`${recordName[0].toUpperCase()}${recordName.slice(1)} ${creating ? "created" : "saved"}`); onClose(); }}><Check />{creating ? "Create record" : "Save changes"}</button></div><p>Changes are saved to your workspace database.</p></section></div>;
}

function Status({ label, tone }: { label: string; tone: StatusTone | string }) {
  return <span className={`status ${tone}`}>{label}</span>;
}

function PageHeader({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div>{action ? <button className="heading-action" onClick={onAction}><Plus />{action}</button> : null}</div>;
}

function MetricCard({ label, value, meta, tone }: { label: string; value: string; meta?: React.ReactNode; tone?: "danger" | "success" }) {
  return <div className={`metric-card ${tone ? `is-${tone}` : ""}`}><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{meta ? <div className={`metric-meta ${tone === "danger" ? "negative" : ""}`}>{meta}</div> : null}</div>;
}

function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (page: number) => void }) { if (totalPages <= 1) return null; const pages = Array.from({ length: totalPages }, (_, index) => index + 1); return <div className="pager" aria-label="Table pages"><button disabled={page === 1} onClick={() => onPageChange(page - 1)} aria-label="Previous page">‹</button>{pages.map((value) => <button key={value} className={page === value ? "active" : ""} aria-current={page === value ? "page" : undefined} onClick={() => onPageChange(value)}>{value}</button>)}<button disabled={page === totalPages} onClick={() => onPageChange(page + 1)} aria-label="Next page">›</button></div>; }

function Sidebar({ active, onNavigate }: { active: PageKey; onNavigate: (p: PageKey) => void }) {
  return <aside className="sidebar"><div className="brand brand-provided"><img src={logo} alt="45Creatives Agency" /></div><nav className="side-nav" aria-label="Primary navigation">{navItems.map(({ label, icon: Icon }) => <button key={label} className={active === label || (active === "Client Details" && label === "Clients") || (active === "Invoice Details" && label === "Invoices") ? "active" : ""} onClick={() => onNavigate(label)}><Icon />{label}</button>)}</nav><div className="sidebar-footer"><button aria-label="Open client records" onClick={() => onNavigate("Clients")}>+</button></div></aside>;
}

function Topbar({ query, onQuery, onNavigate }: { query: string; onQuery: (value: string) => void; onNavigate: (page: PageKey) => void }) {
  const { user, loading, logout } = useAuth();
  const profile = trpc.auth.profile.useQuery(undefined, { enabled: Boolean(user) });
  const avatar = profile.data?.avatarUrl || profile.data?.providerImageUrl || user?.providerImageUrl || nadia;
  return <div className="topbar"><label className="searchbox"><Search /><input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search anything…" aria-label="Search workspace" /></label><div className="topbar-actions"><button className="round-icon" aria-label="Open reports notifications" onClick={() => onNavigate("Reports")}><Bell /></button><button className="round-icon" aria-label="Open 4S Insight help" onClick={() => onNavigate("AI Assistant")}><Headphones /></button>{user ? <button className="profile-chip profile-action" onClick={() => logout().catch((error) => toast.error(error instanceof Error ? error.message : "Unable to sign out"))} disabled={loading} aria-label="Sign out"><img src={avatar} alt="Profile avatar" /><div><strong>{profile.data?.displayName || user.name || "Workspace user"}</strong><span>{loading ? "Signing out…" : "Sign out"}</span></div></button> : <button className="heading-action" onClick={() => startLogin()} disabled={loading}>Sign in</button>}</div></div>;
}

function DashboardQuickStats({ onNavigate, invoiceRows, projectRows, inventoryRows, transactionRows }: { onNavigate: (p: PageKey) => void; invoiceRows: EditableRow[]; projectRows: EditableRow[]; inventoryRows: EditableRow[]; transactionRows: EditableRow[] }) {
  const tracked = invoiceRows.length + projectRows.length + inventoryRows.length + transactionRows.length;
  const overdue = invoiceRows.filter((row) => row[6] === "overdue").length;
  const stockAlerts = inventoryRows.filter((row) => /low stock|out of stock/i.test(row[6] || "")).length;
  return <aside className="panel dashboard-quick-stats" aria-labelledby="quick-stats-title"><div className="panel-head"><div><span className="eyebrow">Workspace pulse</span><h2 id="quick-stats-title" className="panel-title">Quick statistics</h2></div><TrendingUp size={16} /></div><div className="quick-stat-grid"><div><strong>{tracked}</strong><span>Tracked records</span></div><div><strong>{overdue}</strong><span>Invoice follow-ups</span></div><div><strong>{stockAlerts}</strong><span>Stock alerts</span></div></div><button className="text-button" type="button" onClick={() => onNavigate("AI Assistant")}>Ask 4S Insight <ChevronRight /></button></aside>;
}

function DashboardPage({ onNavigate, clientRows, invoiceRows, transactionRows, projectRows, inventoryRows }: { onNavigate: (p: PageKey) => void; clientRows: EditableRow[]; invoiceRows: EditableRow[]; transactionRows: EditableRow[]; projectRows: EditableRow[]; inventoryRows: EditableRow[] }) {
  const { user } = useAuth();
  const name = user?.name || "there";
  const role = user?.role === "admin" ? "Administrator" : "Team member";
  const [revenuePeriod, setRevenuePeriod] = useState("This Year");
  const [cashPeriod, setCashPeriod] = useState("This Month");

  const now = new Date();
  const isThisMonth = (row: EditableRow) => { const date = parseRowDate(row[0]); return date ? date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() : false; };
  const totalRevenue = invoiceRows.filter((row) => row[6] === "paid").reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const outstandingInvoices = invoiceRows.filter((row) => row[6] === "pending" || row[6] === "overdue");
  const outstandingTotal = outstandingInvoices.reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const mtdIncome = transactionRows.filter((row) => row[5] === "positive" && isThisMonth(row)).reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const mtdExpense = transactionRows.filter((row) => row[5] === "negative" && isThisMonth(row)).reduce((sum, row) => sum + parseAmount(row[4]), 0);

  const periodMonths = revenuePeriod === "This Year" ? 12 : revenuePeriod === "This Quarter" ? 3 : 1;
  const revenueSeries = useMemo(() => monthlySeriesFromTransactions(transactionRows, periodMonths), [transactionRows, periodMonths]);

  const cashMonths = cashPeriod === "This Month" ? 1 : cashPeriod === "This Quarter" ? 3 : 12;
  const cashCutoff = new Date(now.getFullYear(), now.getMonth() - cashMonths + 1, 1);
  const cashInflow = transactionRows.filter((row) => row[5] === "positive" && (parseRowDate(row[0]) || cashCutoff) >= cashCutoff).reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const cashOutflow = transactionRows.filter((row) => row[5] === "negative" && (parseRowDate(row[0]) || cashCutoff) >= cashCutoff).reduce((sum, row) => sum + parseAmount(row[4]), 0);

  const recentInvoices = [...invoiceRows].slice(-4).reverse();
  const recentExpenses = [...transactionRows].filter((row) => row[5] === "negative").slice(-4).reverse();

  return <div className="page-content"><PageHeader title={`Welcome back, ${name}`} subtitle={`${role} · Here’s what’s happening with 45Creatives today.`} />
    <section className="dashboard-profile-row"><DashboardProfileCard /><DashboardQuickStats onNavigate={onNavigate} invoiceRows={invoiceRows} projectRows={projectRows} inventoryRows={inventoryRows} transactionRows={transactionRows} /></section>
    <section className="metric-grid"><MetricCard label="Total Revenue" value={formatKsh(totalRevenue)} /><MetricCard label="Outstanding Invoices" value={formatKsh(outstandingTotal)} meta={`${outstandingInvoices.length} invoice${outstandingInvoices.length === 1 ? "" : "s"}`} /><MetricCard label="Total Clients" value={String(clientRows.length)} /><MetricCard label="Profit (MTD)" value={formatKsh(mtdIncome - mtdExpense)} /></section>
    <section className="dashboard-split"><div className="panel"><div className="panel-head"><h2 className="panel-title">Revenue Overview</h2><button className="panel-subtle" onClick={() => { const next = revenuePeriod === "This Year" ? "This Quarter" : revenuePeriod === "This Quarter" ? "This Month" : "This Year"; setRevenuePeriod(next); }}>{revenuePeriod}⌄</button></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={revenueSeries} margin={{ top: 8, right: 5, left: -19, bottom: 0 }}><defs><linearGradient id="revFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#c74d50" stopOpacity={.38} /><stop offset="1" stopColor="#c74d50" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} strokeDasharray="3 3" /><XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fill: "#7e858a", fontSize: 9 }} dy={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#7e858a", fontSize: 8 }} tickFormatter={(v) => `${v}K`} /><Tooltip contentStyle={{ background: "#15171a", border: "1px solid rgba(255,255,255,.1)", borderRadius: 7, fontSize: 10 }} labelStyle={{ color: "#b7babc" }} itemStyle={{ color: "#e86d6e" }} formatter={(value) => [formatKsh((value as number) * 1000), "Revenue"]} /><Area type="monotone" dataKey="revenue" stroke="#d85a5d" strokeWidth={2} fill="url(#revFill)" activeDot={{ r: 4, fill: "#f8e5e4", stroke: "#d85a5d", strokeWidth: 3 }} /></AreaChart></ResponsiveContainer></div></div>
      <div className="panel"><div className="panel-head"><h2 className="panel-title">Cash Flow</h2><button className="panel-subtle" onClick={() => { const next = cashPeriod === "This Month" ? "This Quarter" : cashPeriod === "This Quarter" ? "This Year" : "This Month"; setCashPeriod(next); }}>{cashPeriod}⌄</button></div><div className="cash-list"><div className="cash-item"><span>Inflow <small>↗</small></span><strong>{formatKsh(cashInflow)}</strong></div><div className="cash-item out"><span>Outflow <small>↘</small></span><strong>{formatKsh(cashOutflow)}</strong></div><div className="cash-item net"><span>Net Flow</span><strong>{formatKsh(cashInflow - cashOutflow)}</strong></div></div></div></section>
    <section className="bottom-panels"><div className="panel"><div className="panel-head"><h2 className="panel-title">Recent Invoices</h2><button className="text-button" onClick={() => onNavigate("Invoices")}>View all</button></div><div className="feed">{recentInvoices.length ? recentInvoices.map((row, index) => <div className="feed-row" key={`${row[0]}-${index}`}><i className={`feed-dot ${row[6] === "paid" ? "green" : ""}`} /><span>{row[0]} · {row[1]}</span><span>{row[4]}</span><span><Status label={row[5]} tone={row[6]} /></span></div>) : <p className="activity-empty">No invoices yet.</p>}</div></div><div className="panel"><div className="panel-head"><h2 className="panel-title">Recent Expenses</h2><button className="text-button" onClick={() => onNavigate("Accounting")}>View all</button></div><div className="feed">{recentExpenses.length ? recentExpenses.map((row, index) => <div className="feed-row" key={`${row[1]}-${index}`}><i className="feed-dot" /><span>{row[2] || row[1]}</span><span>{row[4]}</span><span>{row[0]}</span></div>) : <p className="activity-empty">No expenses recorded yet.</p>}</div></div></section>
  </div>;
}

function ClientsPage({ onView, query, rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete }: { onView: (index: number) => void; query: string; rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) {
  const discovery = useTableDiscovery(rows, 5, query);
  const selection = useBulkSelection();
  const visibleIndices = discovery.visibleRows.map(({ index }) => index);
  const active = rows.filter((row) => statusTone(row[5]) === "active").length;
  const pending = rows.filter((row) => statusTone(row[5]) === "pending").length;
  const inactive = rows.length - active - pending;
  const pct = (count: number) => rows.length ? `${Math.round((count / rows.length) * 100)}% of total` : "";
  return <div className="page-content"><PageHeader title="Clients" subtitle="Manage your clients and organizations" action="Add Client" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Total Clients" value={String(rows.length)} /><MetricCard label="Active Clients" value={String(active)} meta={pct(active)} /><MetricCard label="Pending Clients" value={String(pending)} meta={pct(pending)} /><MetricCard label="Inactive Clients" value={String(inactive)} meta={pct(inactive)} tone={inactive > 0 ? "danger" : undefined} /></section><TableDiscovery placeholder="Search clients…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.visibleRows.length} client records`} /><BulkActions selectedCount={selection.selected.size} options={discovery.options.filter((option) => option !== "All")} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible clients" /></th><th>Client Name</th><th>Primary Contact</th><th>Email</th><th>Phone</th><th>Outstanding</th><th>Status</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No clients yet. Add your first client to get started.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={`${r[0]}-${index}`} className="clickable" onClick={() => onView(index)}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td className="value-cell">{r[4]}</td><td><Status label={r[5]} tone={statusTone(r[5])} /></td><td><RecordActions onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>;
}

function LeadsPage({ rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete }: { rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) { const discovery = useTableDiscovery(rows, 4); const selection = useBulkSelection(); const visibleIndices = discovery.visibleRows.map(({ index }) => index); const newCount = rows.filter((row) => statusTone(row[4]) === "new").length; const inProgress = rows.filter((row) => statusTone(row[4]) === "sent" || statusTone(row[4]) === "proposal").length; const converted = rows.filter((row) => statusTone(row[4]) === "accepted" || statusTone(row[4]) === "active").length; return <div className="page-content"><PageHeader title="Leads" subtitle="Track and manage your leads" action="Add Lead" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Total Leads" value={String(rows.length)} /><MetricCard label="New Leads" value={String(newCount)} /><MetricCard label="In Progress" value={String(inProgress)} /><MetricCard label="Converted" value={String(converted)} /></section><TableDiscovery placeholder="Search leads…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.visibleRows.length} leads found`} /><BulkActions selectedCount={selection.selected.size} options={discovery.options.filter((option) => option !== "All")} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible leads" /></th><th>Lead Name</th><th>Company</th><th>Source</th><th>Value</th><th>Status</th><th>Assigned To</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No leads yet. Add your first lead to get started.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={`${r[0]}-${index}`}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td className="value-cell">{r[3]}</td><td><Status label={r[4]} tone={statusTone(r[4])} /></td><td>{r[6]}</td><td><RecordActions onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>; }

function ProjectsPage({ rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete }: { rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) { const discovery = useTableDiscovery(rows, 3); const selection = useBulkSelection(); const visibleIndices = discovery.visibleRows.map(({ index }) => index); const completed = rows.filter((row) => statusTone(row[3]) === "completed").length; const inProgress = rows.filter((row) => statusTone(row[3]) === "in-progress").length; const active = rows.length - completed; return <div className="page-content"><PageHeader title="Projects" subtitle="Manage your projects" action="New Project" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Total Projects" value={String(rows.length)} /><MetricCard label="Active" value={String(active)} /><MetricCard label="In Progress" value={String(inProgress)} /><MetricCard label="Completed" value={String(completed)} /></section><TableDiscovery placeholder="Search projects…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.visibleRows.length} projects found`} /><BulkActions selectedCount={selection.selected.size} options={discovery.options.filter((option) => option !== "All")} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table projects-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible projects" /></th><th>Project Name</th><th>Client</th><th>Progress</th><th>Status</th><th>Due Date</th><th>Value</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No projects yet. Create your first project to get started.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={`${r[0]}-${index}`}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1]}</td><td><div className="progress-cell"><div className="progress-line"><span style={{ width: `${Math.min(100, Math.max(0, Number(r[2]) || 0))}%` }} /></div><small>{r[2]}%</small></div></td><td><Status label={r[3]} tone={statusTone(r[3])} /></td><td>{r[5]}</td><td className="value-cell">{r[6]}</td><td><RecordActions onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>; }

function QuotesPage({ rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete }: { rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) { const discovery = useTableDiscovery(rows, 4); const selection = useBulkSelection(); const visibleIndices = discovery.visibleRows.map(({ index }) => index); const draft = rows.filter((row) => statusTone(row[4]) === "draft").length; const sent = rows.filter((row) => statusTone(row[4]) === "sent").length; const accepted = rows.filter((row) => statusTone(row[4]) === "accepted").length; return <div className="page-content"><PageHeader title="Quotes" subtitle="Create and manage quotations" action="New Quote" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Total Quotes" value={String(rows.length)} /><MetricCard label="Draft" value={String(draft)} /><MetricCard label="Sent" value={String(sent)} /><MetricCard label="Accepted" value={String(accepted)} /></section><TableDiscovery placeholder="Search quotes…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.visibleRows.length} quotes found`} /><BulkActions selectedCount={selection.selected.size} options={discovery.options.filter((option) => option !== "All")} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible quotes" /></th><th>Quote #</th><th>Client</th><th>Project</th><th>Value</th><th>Status</th><th>Valid Until</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No quotes yet. Create your first quote to get started.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={`${r[0]}-${index}`}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td className="value-cell">{r[3]}</td><td><Status label={r[4]} tone={statusTone(r[4])} /></td><td>{r[6]}</td><td><RecordActions onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>; }

function InvoicesPage({ onView, rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete }: { onView: (index: number) => void; rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) { const discovery = useTableDiscovery(rows, 5); const selection = useBulkSelection(); const visibleIndices = discovery.visibleRows.map(({ index }) => index); const paid = rows.filter((row) => statusTone(row[5]) === "paid").length; const pending = rows.filter((row) => statusTone(row[5]) === "pending").length; const overdue = rows.filter((row) => statusTone(row[5]) === "overdue").length; return <div className="page-content"><PageHeader title="Invoices" subtitle="Manage and track invoices" action="New Invoice" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Total Invoices" value={String(rows.length)} /><MetricCard label="Paid" value={String(paid)} tone="success" /><MetricCard label="Pending" value={String(pending)} /><MetricCard label="Overdue" value={String(overdue)} tone={overdue > 0 ? "danger" : undefined} /></section><TableDiscovery placeholder="Search invoices…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.visibleRows.length} invoices found`} /><BulkActions selectedCount={selection.selected.size} options={discovery.options.filter((option) => option !== "All")} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible invoices" /></th><th>Invoice #</th><th>Client</th><th>Date</th><th>Due Date</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No invoices yet. Create your first invoice to get started.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={`${r[0]}-${index}`} className="clickable" onClick={() => onView(index)}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td className="value-cell">{r[4]}</td><td><Status label={r[5]} tone={statusTone(r[5])} /></td><td><RecordActions onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>; }

function PaymentsPage({ rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete }: { rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) {
  const discovery = useTableDiscovery(rows, 6); const selection = useBulkSelection(); const visibleIndices = discovery.visibleRows.map(({ index }) => index);
  const now = new Date();
  const totalReceived = rows.filter((row) => statusTone(row[6]) === "completed").reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const thisMonth = rows.filter((row) => statusTone(row[6]) === "completed" && (() => { const date = parseRowDate(row[3]); return date ? date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() : false; })()).reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const pendingRows = rows.filter((row) => statusTone(row[6]) === "pending");
  const overdueRows = rows.filter((row) => statusTone(row[6]) === "overdue");
  const pendingTotal = pendingRows.reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const overdueTotal = overdueRows.reduce((sum, row) => sum + parseAmount(row[4]), 0);
  return <div className="page-content"><PageHeader title="Payments" subtitle="Track payments and receipts" action="Record Payment" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Total Received" value={formatKsh(totalReceived)} /><MetricCard label="This Month" value={formatKsh(thisMonth)} /><MetricCard label="Pending" value={formatKsh(pendingTotal)} meta={`${pendingRows.length} payment${pendingRows.length === 1 ? "" : "s"}`} tone={pendingRows.length > 0 ? "danger" : undefined} /><MetricCard label="Overdue" value={formatKsh(overdueTotal)} meta={`${overdueRows.length} invoice${overdueRows.length === 1 ? "" : "s"}`} tone={overdueRows.length > 0 ? "danger" : undefined} /></section><TableDiscovery placeholder="Search payments…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.visibleRows.length} payments found`} /><BulkActions selectedCount={selection.selected.size} options={discovery.options.filter((option) => option !== "All")} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible payments" /></th><th>Payment #</th><th>Client</th><th>Invoice</th><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No payments recorded yet.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={`${r[0]}-${index}`}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td className="value-cell">{r[4]}</td><td>{r[5]}</td><td><Status label={r[6]} tone={statusTone(r[6])} /></td><td><RecordActions onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>; }

function ClientDetails({ client, projectRows, invoiceRows, onBack }: { client: EditableRow | null; projectRows: EditableRow[]; invoiceRows: EditableRow[]; onBack: () => void }) {
  if (!client) return <div className="page-content"><PageHeader title="Client Details" subtitle="Clients" /><div className="filterbar"><button className="text-button" onClick={onBack}><ArrowLeft size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Back to clients</button></div><p className="activity-empty">Select a client from the Clients table to view their details.</p></div>;
  const [name, contact, email, phone, outstandingLabel, statusLabel] = client;
  const initials = (name || "?").split(/\s+/).map((word) => word[0]).slice(0, 2).join("").toUpperCase();
  const relatedProjects = projectRows.filter((row) => row[1] === name);
  const relatedInvoices = invoiceRows.filter((row) => row[1] === name);
  const totalPaid = relatedInvoices.filter((row) => row[6] === "paid").reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const outstandingAmount = relatedInvoices.filter((row) => row[6] === "pending" || row[6] === "overdue").reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const overdueAmount = relatedInvoices.filter((row) => row[6] === "overdue").reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const invoicedTotal = totalPaid + outstandingAmount;
  const pieData = invoicedTotal > 0 ? [
    { name: "Paid", value: Math.round((totalPaid / invoicedTotal) * 100), color: "#db6265" },
    { name: "Outstanding", value: Math.round(((outstandingAmount - overdueAmount) / invoicedTotal) * 100), color: "#d8d4cc" },
    { name: "Overdue", value: Math.round((overdueAmount / invoicedTotal) * 100), color: "#8b383a" },
  ].filter((slice) => slice.value > 0) : [];
  return <div className="page-content"><PageHeader title="Client Details" subtitle={`Clients  ›  ${name}`} /><div className="filterbar"><button className="text-button" onClick={onBack}><ArrowLeft size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Back to clients</button></div><section className="client-detail-grid"><div className="panel client-card"><div className="client-identity"><div className="identity-mark">{initials}</div><div><h2>{name}</h2><p>{statusLabel} client</p></div></div><div className="detail-list"><div><UserRound />{contact || "No contact on file"}</div><div><Mail />{email || "No email on file"}</div><div><Phone />{phone || "No phone on file"}</div></div></div><div className="panel"><div className="detail-stats"><div className="detail-stat"><span>Total Projects</span><strong>{relatedProjects.length}</strong></div><div className="detail-stat"><span>Total Invoices</span><strong>{relatedInvoices.length}</strong></div><div className="detail-stat"><span>Total Paid</span><strong>{formatKsh(totalPaid)}</strong></div><div className="detail-stat"><span>Outstanding</span><strong className="red">{outstandingLabel || formatKsh(outstandingAmount)}</strong></div></div><div className="detail-body"><div className="small-panel"><h3>Recent Invoices</h3><div className="feed">{relatedInvoices.length ? relatedInvoices.slice(0,4).map((r) => <div className="feed-row" key={r[0]}><i className={`feed-dot ${r[6] === "paid" ? "green" : ""}`} /><span>{r[0]}</span><span>{r[4]}</span><span>{r[2]}</span></div>) : <p className="activity-empty">No invoices for this client yet.</p>}</div></div><div className="small-panel"><h3>Payment Summary</h3>{pieData.length ? <><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="value" innerRadius={42} outerRadius={62} paddingAngle={4} stroke="none">{pieData.map((p) => <Cell key={p.name} fill={p.color} />)}</Pie></PieChart></ResponsiveContainer></div><div className="donut-legend">{pieData.map((p) => <div className="legend-row" key={p.name}><span><i style={{ background: p.color }} />{p.name}</span><strong>{p.value}%</strong></div>)}</div></> : <p className="activity-empty">No invoiced amounts yet.</p>}</div></div></div></section><section className="bottom-panels" style={{ marginTop: 13 }}><div className="panel"><div className="panel-head"><h2 className="panel-title">Projects</h2></div><div className="feed">{relatedProjects.length ? relatedProjects.slice(0,3).map((p, index) => <div className="feed-row" key={`${p[0]}-${index}`}><i className="feed-dot" /><span>{p[0]}</span><span>{p[2]}%</span><span><Status label={p[3]} tone={p[4]} /></span></div>) : <p className="activity-empty">No projects for this client yet.</p>}</div></div></section></div>;
}

function InvoiceDetails({ invoice, clientRows, onBack, onRecordPayment }: { invoice: EditableRow | null; clientRows: EditableRow[]; onBack: () => void; onRecordPayment: (invoice: EditableRow) => void }) {
  const { user } = useAuth();
  const profile = trpc.workspace.profile.useQuery(undefined, { enabled: Boolean(user) });
  if (!invoice) return <div className="page-content"><PageHeader title="Invoice Details" subtitle="Invoices" /><div className="filterbar"><button className="text-button" onClick={onBack}><ArrowLeft size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Back to invoices</button></div><p className="activity-empty">Select an invoice from the Invoices table to view its details.</p></div>;
  const [number, clientName, issueDate, dueDate, amountLabel, statusLabel, statusToneValue] = invoice;
  const client = clientRows.find((row) => row[0] === clientName);
  const amount = parseAmount(amountLabel);
  const paid = statusToneValue === "paid";
  const businessName = profile.data?.name || "Your workspace";
  const businessAddress = profile.data?.businessAddress;
  const businessEmail = profile.data?.businessEmail;
  const businessPhone = profile.data?.businessPhone;
  return <div className="page-content"><PageHeader title="Invoice Details" subtitle={`Invoices  ›  ${number}`} /><div className="filterbar"><button className="text-button" onClick={onBack}><ArrowLeft size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Back to invoices</button></div><section className="invoice-detail"><div className="panel invoice-paper"><div className="invoice-paper-head"><div><div className="invoice-brand invoice-brand-logo"><img src={logo} alt={businessName} /></div><p>{businessAddress || "Add your business address in Settings"}{businessEmail ? <><br />{businessEmail}</> : null}{businessPhone ? <><br />{businessPhone}</> : null}</p></div><div><div className="invoice-number">{number}<br /><Status label={statusLabel} tone={statusToneValue} /></div><p style={{ textAlign: "right" }}>Issue Date: {issueDate}<br />Due Date: {dueDate}</p></div></div><div className="bill-grid"><div><span>Bill To</span><strong>{clientName}</strong><p>{client?.[1] || ""}{client?.[1] ? <br /> : null}{client?.[2] || "No email on file"}<br />{client?.[3] || "No phone on file"}</p></div></div><table className="invoice-items"><thead><tr><th>Description</th><th>Amount</th></tr></thead><tbody><tr><td>{number} - services rendered</td><td>{formatKsh(amount)}</td></tr></tbody></table><div className="invoice-totals"><div className="invoice-total-row"><span>Total</span><strong>{formatKsh(amount)}</strong></div><div className="invoice-total-row"><span>Paid</span><strong>{formatKsh(paid ? amount : 0)}</strong></div><div className="invoice-total-row final"><span>Balance</span><strong>{formatKsh(paid ? 0 : amount)}</strong></div></div></div><aside className="action-stack"><button onClick={() => toast.success(`Invoice sent to ${clientName}`) }><Send />Send invoice</button><button className="primary" onClick={() => onRecordPayment(invoice)}><CircleDollarSign />Record Payment</button><div className="panel info-card"><h3>Status</h3><p>{paid ? `Paid in full. Issued ${issueDate}.` : `${statusLabel}. Due ${dueDate}.`}</p></div></aside></section></div>;
}

function InventoryPage({ rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete }: { rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) { const discovery = useTableDiscovery(rows, 6); const selection = useBulkSelection(); const visibleIndices = discovery.visibleRows.map(({ index }) => index); const totalValue = rows.reduce((sum, row) => sum + parseAmount(row[5]), 0); const lowStockCount = rows.filter((row) => /low stock|out of stock/i.test(row[6] || "")).length; const categories = new Set(rows.map((row) => row[1]).filter(Boolean)).size; return <div className="page-content"><PageHeader title="Inventory" subtitle="Track equipment, assets, and production supplies" action="Add Item" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Tracked Items" value={String(rows.length)} meta={categories ? `Across ${categories} categor${categories === 1 ? "y" : "ies"}` : undefined} /><MetricCard label="Inventory Value" value={formatKsh(totalValue)} /><MetricCard label="Low Stock" value={String(lowStockCount)} meta={lowStockCount ? "Needs attention" : "All items well stocked"} tone={lowStockCount ? "danger" : undefined} /></section><TableDiscovery placeholder="Search inventory…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.visibleRows.length} item${discovery.visibleRows.length === 1 ? "" : "s"}`} /><BulkActions selectedCount={selection.selected.size} options={discovery.options.filter((option) => option !== "All")} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible inventory items" /></th><th>Item</th><th>Category</th><th>SKU</th><th>Qty.</th><th>Unit Cost</th><th>Stock Value</th><th>Status</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={9} className="activity-empty">No inventory items yet. Add your first item to get started.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={`${r[2]}-${index}`}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>{r[3]}</td><td className="value-cell">{r[4]}</td><td className="value-cell">{r[5]}</td><td><Status label={r[6]} tone={statusTone(r[6])} /></td><td><RecordActions onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>; }

type ContractFormState = {
  clientId: string; projectId: string; providerName: string; providerEmail: string; providerPhone: string;
  clientName: string; clientEmail: string; clientPhone: string;
  projectName: string; websiteType: string; pages: string; features: string;
  totalCost: string; depositPercent: string; paymentMethod: string;
  startDate: string; deliveryWeeks: string; revisionRounds: string; extraRevisionCost: string; contentDueDate: string;
  domainIncluded: boolean; domainName: string; hostingIncluded: boolean; hostingPlatform: string; hostingCost: string;
  maintenanceFee: string; notes: string;
};

function emptyContractForm(): ContractFormState {
  return { clientId: "", projectId: "", providerName: "45Creatives", providerEmail: "", providerPhone: "", clientName: "", clientEmail: "", clientPhone: "", projectName: "", websiteType: "Business website", pages: "Home, About, Services, Projects, Contact", features: "Contact form", totalCost: "", depositPercent: "50", paymentMethod: "M-Pesa", startDate: "", deliveryWeeks: "2", revisionRounds: "2", extraRevisionCost: "", contentDueDate: "", domainIncluded: false, domainName: "", hostingIncluded: false, hostingPlatform: "", hostingCost: "", maintenanceFee: "", notes: "" };
}

type ContractRecord = {
  id: string; title: string; status: "draft" | "sent" | "signed" | "voided";
  clientId: string | null; clientName: string; clientEmail: string | null; clientPhone: string | null;
  projectId: string | null;
  providerName: string; providerEmail: string | null; providerPhone: string | null;
  fields: ContractFields; documentHtml: string;
  providerSignatureName: string | null; providerSignedAt: Date | string | null;
  clientSignatureName: string | null; clientSignedAt: Date | string | null;
  createdAt: Date | string;
  whatsappMessageId: string | null;
  whatsappDeliveryStatus: "sent" | "delivered" | "read" | "failed" | null;
  whatsappSentAt: Date | string | null;
  whatsappDeliveredAt: Date | string | null;
  whatsappReadAt: Date | string | null;
  documensoEnvelopeId: string | null; documensoStatus: "pending" | "completed" | "rejected" | "cancelled" | null;
  documensoProviderSigningUrl: string | null; documensoClientSigningUrl: string | null;
  documensoCertifiedPdfPath: string | null;
};

function contractToForm(contract: ContractRecord): ContractFormState {
  const f = contract.fields;
  return { clientId: contract.clientId || "", projectId: contract.projectId || "", providerName: contract.providerName, providerEmail: contract.providerEmail || "", providerPhone: contract.providerPhone || "", clientName: contract.clientName, clientEmail: contract.clientEmail || "", clientPhone: contract.clientPhone || "", projectName: f.projectName, websiteType: f.websiteType, pages: f.pages, features: f.features, totalCost: String(f.totalCost || ""), depositPercent: String(f.depositPercent ?? 50), paymentMethod: f.paymentMethod, startDate: f.startDate, deliveryWeeks: f.deliveryWeeks, revisionRounds: String(f.revisionRounds ?? 2), extraRevisionCost: String(f.extraRevisionCost || ""), contentDueDate: f.contentDueDate, domainIncluded: f.domainIncluded, domainName: f.domainName, hostingIncluded: f.hostingIncluded, hostingPlatform: f.hostingPlatform, hostingCost: String(f.hostingCost || ""), maintenanceFee: String(f.maintenanceFee || ""), notes: f.notes };
}

function contractFormToInput(form: ContractFormState) {
  return {
    clientId: form.clientId || undefined,
    projectId: form.projectId || undefined,
    providerName: form.providerName.trim(),
    providerEmail: form.providerEmail.trim() || undefined,
    providerPhone: form.providerPhone.trim() || undefined,
    clientName: form.clientName.trim(),
    clientEmail: form.clientEmail.trim() || undefined,
    clientPhone: form.clientPhone.trim() || undefined,
    fields: {
      projectName: form.projectName.trim(),
      websiteType: form.websiteType.trim() || "Business website",
      pages: form.pages.trim(),
      features: form.features.trim(),
      totalCost: Number(form.totalCost) || 0,
      depositPercent: Math.min(100, Math.max(0, Number(form.depositPercent) || 0)),
      paymentMethod: form.paymentMethod.trim() || "M-Pesa",
      startDate: form.startDate.trim(),
      deliveryWeeks: form.deliveryWeeks.trim(),
      revisionRounds: Math.max(0, Number(form.revisionRounds) || 0),
      extraRevisionCost: Number(form.extraRevisionCost) || 0,
      contentDueDate: form.contentDueDate.trim(),
      domainIncluded: form.domainIncluded,
      domainName: form.domainName.trim(),
      hostingIncluded: form.hostingIncluded,
      hostingPlatform: form.hostingPlatform.trim(),
      hostingCost: Number(form.hostingCost) || 0,
      maintenanceFee: Number(form.maintenanceFee) || 0,
      notes: form.notes.trim(),
    },
  };
}

function ContractFormDialog({ open, initial, onClose, onSubmit, submitting }: { open: boolean; initial: ContractFormState; onClose: () => void; onSubmit: (form: ContractFormState) => void; submitting: boolean }) {
  const [form, setForm] = useState<ContractFormState>(initial);
  useEffect(() => { if (open) setForm(initial); }, [open, initial]);
  const clients = trpc.crm.clients.list.useQuery(undefined, { enabled: open });
  const projects = trpc.crm.projects.list.useQuery(undefined, { enabled: open });
  if (!open) return null;
  const set = <K extends keyof ContractFormState>(key: K, value: ContractFormState[K]) => setForm((current) => ({ ...current, [key]: value }));
  const applyClient = (id: string) => {
    set("clientId", id);
    const client = clients.data?.find((c) => c.id === id);
    if (client) { set("clientName", client.name); set("clientEmail", client.email || ""); set("clientPhone", client.phone || ""); }
  };
  const applyProject = (id: string) => {
    set("projectId", id);
    const proj = projects.data?.find((p) => p.id === id);
    if (proj) {
      if (!form.projectName || form.projectName === "Untitled project") {
        set("projectName", proj.name);
      }
      if (proj.clientId && (!form.clientId || form.clientId !== proj.clientId)) {
        applyClient(proj.clientId);
      }
    }
  };
  const canSubmit = form.providerName.trim() && form.clientName.trim() && form.projectName.trim();
  return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="record-dialog panel contract-dialog" role="dialog" aria-modal="true" aria-labelledby="contract-form-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="record-dialog-head"><div><span className="eyebrow">Web design & development agreement</span><h2 id="contract-form-title">{initial.projectName ? "Edit service agreement" : "New service agreement"}</h2></div><button className="record-close" aria-label="Close" onClick={onClose}><X /></button></div>
      <div className="contract-form-sections">
        <fieldset><legend>Parties & Project</legend><div className="record-fields">
          <label>Your business name<input value={form.providerName} onChange={(e) => set("providerName", e.target.value)} /></label>
          <label>Your email<input type="email" value={form.providerEmail} onChange={(e) => set("providerEmail", e.target.value)} /></label>
          <label>Your phone<input value={form.providerPhone} onChange={(e) => set("providerPhone", e.target.value)} placeholder="+254 7XX XXX XXX" /></label>
          <label>Select project<select value={form.projectId} onChange={(e) => applyProject(e.target.value)}><option value="">Enter manually / New project</option>{(projects.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label>Select client<select value={form.clientId} onChange={(e) => applyClient(e.target.value)}><option value="">Enter manually</option>{(clients.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label>Client name<input value={form.clientName} onChange={(e) => set("clientName", e.target.value)} /></label>
          <label>Client email<input type="email" value={form.clientEmail} onChange={(e) => set("clientEmail", e.target.value)} /></label>
          <label>Client phone (WhatsApp)<input value={form.clientPhone} onChange={(e) => set("clientPhone", e.target.value)} placeholder="+254 7XX XXX XXX" /></label>
        </div></fieldset>
        <fieldset><legend>Scope of work</legend><div className="record-fields">
          <label>Project name<input value={form.projectName} onChange={(e) => set("projectName", e.target.value)} /></label>
          <label>Website type<input value={form.websiteType} onChange={(e) => set("websiteType", e.target.value)} /></label>
          <label className="wide">Pages included<input value={form.pages} onChange={(e) => set("pages", e.target.value)} /></label>
          <label className="wide">Features included<input value={form.features} onChange={(e) => set("features", e.target.value)} /></label>
        </div></fieldset>
        <fieldset><legend>Price & payment</legend><div className="record-fields">
          <label>Total cost (KES)<input type="number" min="0" value={form.totalCost} onChange={(e) => set("totalCost", e.target.value)} /></label>
          <label>Deposit (%)<input type="number" min="0" max="100" value={form.depositPercent} onChange={(e) => set("depositPercent", e.target.value)} /></label>
          <label>Payment method<input value={form.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)} /></label>
        </div></fieldset>
        <fieldset><legend>Timeline & revisions</legend><div className="record-fields">
          <label>Start date<input value={form.startDate} onChange={(e) => set("startDate", e.target.value)} placeholder="Upon receipt of deposit" /></label>
          <label>Delivery (weeks)<input value={form.deliveryWeeks} onChange={(e) => set("deliveryWeeks", e.target.value)} /></label>
          <label>Included revision rounds<input type="number" min="0" value={form.revisionRounds} onChange={(e) => set("revisionRounds", e.target.value)} /></label>
          <label>Extra revision cost (KES)<input type="number" min="0" value={form.extraRevisionCost} onChange={(e) => set("extraRevisionCost", e.target.value)} /></label>
          <label>Content due date<input value={form.contentDueDate} onChange={(e) => set("contentDueDate", e.target.value)} /></label>
        </div></fieldset>
        <fieldset><legend>Hosting, domain & maintenance</legend><div className="record-fields">
          <label className="checkbox-field"><input type="checkbox" checked={form.domainIncluded} onChange={(e) => set("domainIncluded", e.target.checked)} />Domain included</label>
          <label>Domain name<input value={form.domainName} onChange={(e) => set("domainName", e.target.value)} disabled={!form.domainIncluded} /></label>
          <label className="checkbox-field"><input type="checkbox" checked={form.hostingIncluded} onChange={(e) => set("hostingIncluded", e.target.checked)} />Hosting included</label>
          <label>Hosting platform<input value={form.hostingPlatform} onChange={(e) => set("hostingPlatform", e.target.value)} disabled={!form.hostingIncluded} /></label>
          <label>Annual hosting cost (KES)<input type="number" min="0" value={form.hostingCost} onChange={(e) => set("hostingCost", e.target.value)} /></label>
          <label>Monthly maintenance fee (KES)<input type="number" min="0" value={form.maintenanceFee} onChange={(e) => set("maintenanceFee", e.target.value)} /></label>
        </div></fieldset>
        <fieldset><legend>Additional notes</legend><textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Anything else specific to this project" /></fieldset>
      </div>
      <div className="record-dialog-actions">
        <button className="record-reset" onClick={onClose}>Cancel</button>
        <button className="record-save" disabled={submitting || !canSubmit} onClick={() => onSubmit(form)}><Check />{submitting ? "Saving…" : "Save agreement"}</button>
      </div>
    </section>
  </div>;
}

function ContractStatusBadge({ status }: { status: string }) {
  const tone = status === "signed" ? "paid" : status === "sent" ? "sent" : status === "voided" ? "overdue" : "draft";
  return <Status label={status.charAt(0).toUpperCase() + status.slice(1)} tone={tone} />;
}

function ContractViewDialog({ contract, onClose, onDelete, deleting }: { contract: ContractRecord | null; onClose: () => void; onDelete: (contract: ContractRecord) => void; deleting: boolean }) {
  const utils = trpc.useUtils();
  const [signatureName, setSignatureName] = useState("");
  const [sending, setSending] = useState<"email" | "whatsapp" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sendResult, setSendResult] = useState<{ channel: "email" | "whatsapp"; signingUrl: string; waLink: string | null; emailDraftUrl: string; deliveryError: string | null; emailConfigured: boolean; whatsappCloudConfigured: boolean; documensoConfigured: boolean; documensoEnvelopeId: string | null; documensoError: string | null } | null>(null);
  const waMessages = trpc.whatsapp.listByContract.useQuery(
    { contractId: contract?.id || "" },
    { enabled: Boolean(contract?.id) }
  );
  useEffect(() => { setSignatureName(""); setSendResult(null); }, [contract?.id]);
  const signProvider = trpc.contracts.signProvider.useMutation({ onSuccess: () => { toast.success("You signed the agreement"); utils.contracts.list.invalidate(); utils.contracts.get.invalidate(); }, onError: (error) => toast.error(error.message) });
  const send = trpc.contracts.send.useMutation({
    onSuccess: (result) => {
      setSendResult(result);
      utils.contracts.list.invalidate();
      if (contract?.id) utils.whatsapp.listByContract.invalidate({ contractId: contract.id });
      if (result.deliveryError) {
        toast.error(`Link ready, but automatic delivery failed: ${result.deliveryError}`);
      } else if (result.channel === "whatsapp") {
        if (result.whatsappCloudConfigured) toast.success("Agreement sent directly to client's WhatsApp");
        else toast.success("Signing link ready. Open WhatsApp to send it.");
      } else {
        toast.success("Agreement sent to the client");
      }
      setSending(null);
    },
    onError: (error) => { toast.error(error.message); setSending(null); },
  });
  const resendCopies = trpc.contracts.resendSignedCopies.useMutation({ onSuccess: ({ sent }) => toast.success(sent ? `Signed copy emailed to ${sent} recipient${sent === 1 ? "" : "s"}` : "No email recipients on file"), onError: (error) => toast.error(error.message) });
  const voidMutation = trpc.contracts.void.useMutation({ onSuccess: () => { toast.success("Agreement withdrawn"); utils.contracts.list.invalidate(); onClose(); }, onError: (error) => toast.error(error.message) });
  if (!contract) return null;
  const copy = (value: string) => { navigator.clipboard?.writeText(value).then(() => toast.success("Copied to clipboard")).catch(() => toast.error("Could not copy")); };
  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const pdf = await utils.client.contracts.downloadPdf.query({ id: contract.id });
      downloadBase64Pdf(pdf.content, pdf.filename);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not generate the PDF"); }
    finally { setDownloading(false); }
  };
  return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="record-dialog panel contract-view-dialog" role="dialog" aria-modal="true" aria-labelledby="contract-view-title" onMouseDown={(event) => event.stopPropagation()}>
      <div className="record-dialog-head"><div><span className="eyebrow">{contract.clientName}</span><h2 id="contract-view-title">{contract.fields.projectName || contract.title}</h2></div><button className="record-close" aria-label="Close" onClick={onClose}><X /></button></div>
      <div className="contract-status-row"><ContractStatusBadge status={contract.status} /><span className="panel-subtle">KES {Number(contract.fields.totalCost || 0).toLocaleString("en-KE")} total</span></div>
      {contract.status !== "voided" && <>
        <div className="contract-signer-row"><div><strong>Service Provider - {contract.providerName}</strong><span>{contract.providerSignedAt ? `Signed by ${contract.providerSignatureName} on ${new Date(contract.providerSignedAt).toLocaleString()}` : "Not yet signed"}</span></div>{!contract.providerSignedAt && <ShieldCheck size={16} color="#d97879" />}</div>
        <div className="contract-signer-row"><div><strong>Client - {contract.clientName}</strong><span>{contract.clientSignedAt ? `Signed by ${contract.clientSignatureName} on ${new Date(contract.clientSignedAt).toLocaleString()}` : "Not yet signed"}</span></div>{!contract.clientSignedAt && contract.status === "sent" && <span className="panel-subtle">Awaiting client</span>}</div>
      </>}
      {contract.whatsappDeliveryStatus && (
        <div className="contract-link-box" style={{ borderColor: contract.whatsappDeliveryStatus === "read" ? "#25D366" : undefined }}>
          <MessageCircle size={13} color={contract.whatsappDeliveryStatus === "read" ? "#25D366" : "#4ade80"} />
          <span>
            WhatsApp: <strong style={{ color: contract.whatsappDeliveryStatus === "read" ? "#25D366" : undefined }}>{contract.whatsappDeliveryStatus.toUpperCase()}</strong>
            {contract.whatsappReadAt
              ? ` · Read by client on ${new Date(contract.whatsappReadAt).toLocaleString()}`
              : contract.whatsappDeliveredAt
              ? ` · Delivered to client on ${new Date(contract.whatsappDeliveredAt).toLocaleString()}`
              : contract.whatsappSentAt
              ? ` · Dispatched via WhatsApp Cloud API on ${new Date(contract.whatsappSentAt).toLocaleString()}`
              : ""}
          </span>
        </div>
      )}
      {!contract.providerSignedAt && contract.status === "draft" && <div className="contract-actions-row"><input value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder="Type your full name to sign" style={{ flex: "1 1 220px", height: 32, padding: "0 10px", borderRadius: 8, border: "1px solid rgba(255,255,255,.14)", background: "rgba(4,6,8,.31)", color: "#eef0ed", fontSize: 9 }} /><button className="primary" disabled={!signatureName.trim() || signProvider.isPending} onClick={() => signProvider.mutate({ id: contract.id, signatureName: signatureName.trim() })}><PenTool />{signProvider.isPending ? "Signing…" : "Sign as provider"}</button></div>}
      {contract.providerSignedAt && (contract.status === "draft" || contract.status === "sent") && <div className="contract-actions-row">
        <button disabled={sending !== null} onClick={() => { setSending("email"); send.mutate({ id: contract.id, channel: "email" }); }}><Mail />{sending === "email" ? "Sending…" : "Send by email"}</button>
        <button disabled={sending !== null} onClick={() => { setSending("whatsapp"); send.mutate({ id: contract.id, channel: "whatsapp" }); }}><MessageCircle />{sending === "whatsapp" ? "Sending…" : "Send via WhatsApp"}</button>
        <button onClick={() => voidMutation.mutate({ id: contract.id })}><Trash2 />Withdraw</button>
      </div>}
      {sendResult && <>
        <div className="contract-link-box"><ExternalLink size={12} /><span>{sendResult.signingUrl}</span><button className="text-button" onClick={() => copy(sendResult.signingUrl)}><Copy size={11} />Copy</button></div>
        {sendResult.waLink && <div className="contract-link-box"><MessageCircle size={12} /><span>{sendResult.whatsappCloudConfigured ? "Sent automatically via WhatsApp Cloud API" : "No WhatsApp API configured - open this link to send from your own WhatsApp"}</span><a className="text-button" href={sendResult.waLink} target="_blank" rel="noreferrer"><ExternalLink size={11} />Open WhatsApp</a></div>}
        {sendResult.channel === "email" && (sendResult.deliveryError || !sendResult.emailConfigured) && <div className="contract-link-box"><Mail size={12} /><span>{sendResult.deliveryError || "Automatic email is not configured"}</span><a className="text-button" href={sendResult.emailDraftUrl}><ExternalLink size={11} />Open email draft</a></div>}
        {!sendResult.emailConfigured && <p className="panel-subtle">To enable automatic email delivery, configure RESEND_API_KEY and RESEND_FROM_EMAIL on the server.</p>}
        {sendResult.documensoConfigured
          ? sendResult.documensoEnvelopeId
            ? <div className="contract-link-box"><ShieldCheck size={12} /><span>Certified signature copy sent via Documenso to both of you - check your email.</span></div>
            : sendResult.documensoError && <p className="panel-subtle">Documenso signature copy not sent: {sendResult.documensoError}</p>
          : <p className="panel-subtle">Set DOCUMENSO_API_KEY on the server to also collect a certified signature via Documenso.</p>}
      </>}
      {waMessages.data && waMessages.data.length > 0 && (
        <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: 8, background: "rgba(4,6,8,0.4)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8, fontSize: 11, fontWeight: 600, color: "#25D366" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><MessageCircle size={12} /> WhatsApp Activity ({waMessages.data.length})</span>
            <button className="text-button" onClick={() => waMessages.refetch()} style={{ fontSize: 9 }}><RefreshCw size={10} />Refresh</button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 180, overflowY: "auto" }}>
            {waMessages.data.map((m) => (
              <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", padding: "6px 8px", borderRadius: 6, background: m.direction === "inbound" ? "rgba(37,211,102,0.09)" : "rgba(255,255,255,0.03)", fontSize: 10 }}>
                <div style={{ flex: 1, paddingRight: 8 }}>
                  <span style={{ fontWeight: 600, color: m.direction === "inbound" ? "#25D366" : "#eef0ed" }}>
                    {m.direction === "inbound" ? `Client (${m.phone})` : "45Creatives"}
                  </span>
                  <p style={{ margin: "2px 0 0", color: "#a6ada9", whiteSpace: "pre-wrap", fontSize: 9 }}>{m.body.length > 180 ? `${m.body.slice(0, 180)}…` : m.body}</p>
                </div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <span className={`status-badge status-${m.status === "read" || m.status === "delivered" ? "paid" : m.status === "failed" ? "overdue" : "sent"}`} style={{ fontSize: 8, padding: "1px 5px" }}>
                    {m.status}
                  </span>
                  <div style={{ fontSize: 8, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {contract.status === "signed" && <div className="contract-actions-row"><button disabled={downloading} onClick={downloadPdf}><FileDown />{downloading ? "Preparing…" : "Download PDF"}</button><button disabled={resendCopies.isPending} onClick={() => resendCopies.mutate({ id: contract.id })}><Send />{resendCopies.isPending ? "Sending…" : "Re-email signed copies"}</button></div>}
      {contract.documensoStatus && <div className="contract-link-box">
        <ShieldCheck size={12} />
        <span>
          {contract.documensoStatus === "completed" ? "Documenso certified copy: both parties signed"
            : contract.documensoStatus === "pending" ? "Documenso certified copy: awaiting signatures"
            : contract.documensoStatus === "rejected" ? "Documenso certified copy: a signer rejected it"
            : "Documenso certified copy: cancelled"}
        </span>
        {contract.documensoStatus === "completed" && contract.documensoCertifiedPdfPath && <a className="text-button" href={contract.documensoCertifiedPdfPath} target="_blank" rel="noreferrer"><FileDown size={11} />Download certified PDF</a>}
        {contract.documensoStatus === "pending" && contract.documensoProviderSigningUrl && <a className="text-button" href={contract.documensoProviderSigningUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} />Sign on Documenso</a>}
      </div>}
      <div className="contract-actions-row"><button className="contract-delete-button" disabled={deleting} onClick={() => onDelete(contract)}><Trash2 />{deleting ? "Deleting…" : "Delete agreement"}</button></div>
      <div className="contract-document" dangerouslySetInnerHTML={{ __html: contract.documentHtml }} />
    </section>
  </div>;
}

function ContractsPage() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const list = trpc.contracts.list.useQuery(undefined, { enabled: Boolean(user) });
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const create = trpc.contracts.create.useMutation({ onSuccess: async (contract) => { toast.success("Agreement created"); setFormOpen(false); await utils.contracts.list.invalidate(); setViewingId(contract.id); }, onError: (error) => toast.error(error.message) });
  const update = trpc.contracts.update.useMutation({ onSuccess: () => { toast.success("Agreement updated"); setFormOpen(false); setEditingId(null); utils.contracts.list.invalidate(); }, onError: (error) => toast.error(error.message) });
  const remove = trpc.contracts.delete.useMutation({ onSuccess: () => { toast.success("Agreement deleted"); setViewingId(null); utils.contracts.list.invalidate(); }, onError: (error) => toast.error(error.message) });
  const contracts = (list.data || []) as ContractRecord[];
  const counts = { total: contracts.length, draft: contracts.filter((c) => c.status === "draft").length, sent: contracts.filter((c) => c.status === "sent").length, signed: contracts.filter((c) => c.status === "signed").length };
  const editingContract = editingId ? contracts.find((c) => c.id === editingId) || null : null;
  const viewingContract = viewingId ? contracts.find((c) => c.id === viewingId) || null : null;
  const deleteAgreement = (contract: ContractRecord) => {
    if (window.confirm(`Permanently delete "${contract.title}"? This cannot be undone.`)) remove.mutate({ id: contract.id });
  };
  return <div className="page-content">
    <PageHeader title="Contracts" subtitle="Send web design agreements for electronic signature" action="New Agreement" onAction={() => { setEditingId(null); setFormOpen(true); }} />
    <section className="metric-grid">
      <MetricCard label="Total Agreements" value={String(counts.total)} />
      <MetricCard label="Draft" value={String(counts.draft)} />
      <MetricCard label="Awaiting Signature" value={String(counts.sent)} />
      <MetricCard label="Signed" value={String(counts.signed)} />
    </section>
    <div className="panel table-panel"><div className="table-scroller"><table className="data-table">
      <thead><tr><th>Project</th><th>Client</th><th>Total</th><th>Status</th><th>Created</th><th></th></tr></thead>
      <tbody>{contracts.length === 0 ? <tr><td colSpan={6} className="activity-empty">No agreements yet. Create one to get started.</td></tr> : contracts.map((c) => <tr key={c.id} className="clickable" onClick={() => setViewingId(c.id)}>
        <td className="strong-cell">
          {c.fields.projectName || c.title}
          {c.whatsappDeliveryStatus && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 9,
                fontWeight: 600,
                padding: "1px 6px",
                borderRadius: 4,
                background: c.whatsappDeliveryStatus === "read" ? "rgba(37,211,102,0.2)" : "rgba(255,255,255,0.08)",
                color: c.whatsappDeliveryStatus === "read" ? "#25D366" : "#a6ada9",
              }}
              title={`WhatsApp status: ${c.whatsappDeliveryStatus}`}
            >
              WA: {c.whatsappDeliveryStatus}
            </span>
          )}
        </td>
        <td>{c.clientName}</td>
        <td className="value-cell">KES {Number(c.fields.totalCost || 0).toLocaleString("en-KE")}</td>
        <td><ContractStatusBadge status={c.status} /></td>
        <td>{new Date(c.createdAt).toLocaleDateString("en-KE")}</td>
        <td onClick={(event) => event.stopPropagation()}><div className="record-actions"><button className="record-edit" onClick={() => setViewingId(c.id)}><FileText />View</button>{c.status === "draft" && <button className="record-edit" onClick={() => { setEditingId(c.id); setFormOpen(true); }}><Pencil />Edit</button>}<button className="record-edit contract-delete-button" onClick={() => deleteAgreement(c)}><Trash2 />Delete</button></div></td>
      </tr>)}</tbody>
    </table></div></div>
    <ContractFormDialog open={formOpen} initial={editingContract ? contractToForm(editingContract) : emptyContractForm()} submitting={create.isPending || update.isPending} onClose={() => { setFormOpen(false); setEditingId(null); }} onSubmit={(form) => { const payload = contractFormToInput(form); if (editingId) update.mutate({ id: editingId, ...payload }); else create.mutate(payload); }} />
    <ContractViewDialog contract={viewingContract} onClose={() => setViewingId(null)} onDelete={deleteAgreement} deleting={remove.isPending} />
  </div>;
}

/** Weighted inputs behind the Business Health Score: collection rate (Invoices/Payments),
 * profit margin (Transactions), on-time delivery (Projects), and lead conversion (Leads).
 * Each is computed straight from real workspace records - no invented numbers - and a
 * component is left out of the average entirely when there isn't enough data yet to compute it. */
function useBusinessHealth(invoiceRows: EditableRow[], transactionRows: EditableRow[], projectRows: EditableRow[], leadRows: EditableRow[]) {
  return useMemo(() => {
    const now = new Date();
    const isThisMonth = (row: EditableRow) => { const d = parseRowDate(row[0]); return d ? d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() : false; };
    const isLastMonth = (row: EditableRow) => { const d = parseRowDate(row[0]); const last = new Date(now.getFullYear(), now.getMonth() - 1, 1); return d ? d.getFullYear() === last.getFullYear() && d.getMonth() === last.getMonth() : false; };
    const mtdIncome = transactionRows.filter((r) => r[5] === "positive" && isThisMonth(r)).reduce((sum, r) => sum + parseAmount(r[4]), 0);
    const mtdExpense = transactionRows.filter((r) => r[5] === "negative" && isThisMonth(r)).reduce((sum, r) => sum + parseAmount(r[4]), 0);
    const lastMonthIncome = transactionRows.filter((r) => r[5] === "positive" && isLastMonth(r)).reduce((sum, r) => sum + parseAmount(r[4]), 0);
    const revenueChange = lastMonthIncome > 0 ? ((mtdIncome - lastMonthIncome) / lastMonthIncome) * 100 : null;

    const invoiced = invoiceRows.filter((r) => (r.at(-1) || "").toLowerCase() !== "draft");
    const totalInvoiced = invoiced.reduce((sum, r) => sum + parseAmount(r[4]), 0);
    const totalPaid = invoiced.filter((r) => (r.at(-1) || "").toLowerCase() === "paid").reduce((sum, r) => sum + parseAmount(r[4]), 0);
    const collectionRate = totalInvoiced > 0 ? (totalPaid / totalInvoiced) * 100 : null;

    const profitMargin = mtdIncome > 0 ? Math.max(0, Math.min(100, ((mtdIncome - mtdExpense) / mtdIncome) * 100)) : null;

    const activeProjects = projectRows.filter((r) => !(r[4] || "").toLowerCase().includes("cancel"));
    const onTimeProjects = activeProjects.filter((r) => { if ((r[4] || "").toLowerCase().includes("complete")) return true; const due = parseRowDate(r[5]); return due ? due >= now : true; });
    const onTimeRate = activeProjects.length > 0 ? (onTimeProjects.length / activeProjects.length) * 100 : null;

    const decidedLeads = leadRows.filter((r) => ["won", "lost"].includes((r[4] || "").toLowerCase()));
    const wonLeads = decidedLeads.filter((r) => (r[4] || "").toLowerCase() === "won");
    const conversionRate = decidedLeads.length > 0 ? (wonLeads.length / decidedLeads.length) * 100 : null;

    const components = [
      { label: "Collection rate", value: collectionRate, color: "#7ea8d6" },
      { label: "Profit margin", value: profitMargin, color: "#78bd8e" },
      { label: "On-time delivery", value: onTimeRate, color: "#d5aa67" },
      { label: "Lead conversion", value: conversionRate, color: "#d55a5d" },
    ];
    const scored = components.filter((c): c is { label: string; value: number; color: string } => c.value !== null);
    const score = scored.length ? Math.round(scored.reduce((sum, c) => sum + c.value, 0) / scored.length) : null;
    return { mtdIncome, revenueChange, components, score, scoredCount: scored.length };
  }, [invoiceRows, transactionRows, projectRows, leadRows]);
}

function WebsiteTrafficPanel() {
  const query = trpc.reports.traffic.useQuery({ days: 30 });
  if (query.isLoading) return <div className="panel report-traffic"><div className="panel-head"><h2 className="panel-title">Website Traffic</h2><Globe size={14} color="#a8afb5" /></div><p className="panel-subtle">Loading…</p></div>;
  if (query.isError) return <div className="panel report-traffic"><div className="panel-head"><h2 className="panel-title">Website Traffic</h2><Globe size={14} color="#a8afb5" /></div><p className="panel-subtle">{query.error.message}</p></div>;
  const data = query.data!;
  if (!data.configured || !data.summary) return <div className="panel report-traffic"><div className="panel-head"><h2 className="panel-title">Website Traffic</h2><Globe size={14} color="#a8afb5" /></div><p className="panel-subtle">Connect Google Analytics (GA4) to see sessions, users, and conversions from 45creatives.co.ke here. Add <code>GA4_PROPERTY_ID</code>, <code>GA4_CLIENT_EMAIL</code>, and <code>GA4_PRIVATE_KEY</code> on the server to enable this panel.</p></div>;
  const summary = data.summary;
  const conversionRate = summary.sessions > 0 ? (summary.conversions / summary.sessions) * 100 : 0;
  return <div className="panel report-traffic"><div className="panel-head"><h2 className="panel-title">Website Traffic</h2><span className="panel-subtle">Last 30 days · 45creatives.co.ke</span></div><div className="traffic-metric-row"><div><strong>{summary.sessions.toLocaleString()}</strong><span>Sessions</span></div><div><strong>{summary.activeUsers.toLocaleString()}</strong><span>Active users</span></div><div><strong>{summary.conversions.toLocaleString()}</strong><span>Conversions</span></div><div><strong>{conversionRate.toFixed(1)}%</strong><span>Conversion rate</span></div></div><div className="chart-wrap accounting-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={summary.daily} margin={{ top: 8, right: 5, left: -19, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} strokeDasharray="3 3" /><XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#9ca2a8", fontSize: 8 }} dy={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#9ca2a8", fontSize: 8 }} /><Area isAnimationActive={false} type="monotone" dataKey="sessions" stroke="#7ea8d6" strokeWidth={2} fill="rgba(126,168,214,.12)" /><Area isAnimationActive={false} type="monotone" dataKey="conversions" stroke="#78bd8e" strokeWidth={2} fill="rgba(120,189,142,.12)" /></AreaChart></ResponsiveContainer></div></div>;
}

function ReportsPage({ rows, invoiceRows, transactionRows, projectRows, leadRows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete }: { rows: EditableRow[]; invoiceRows: EditableRow[]; transactionRows: EditableRow[]; projectRows: EditableRow[]; leadRows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) {
  const health = useBusinessHealth(invoiceRows, transactionRows, projectRows, leadRows);
  const discovery = useTableDiscovery(rows, 3);
  const selection = useBulkSelection();
  const visibleIndices = discovery.visibleRows.map(({ index }) => index);
  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  return <div className="page-content"><PageHeader title="Reports" subtitle="Measure financial health, delivery, and growth" action="Create Report" onAction={onCreate} /><section className="report-hero"><div className="panel report-highlight"><div className="report-highlight-top"><span className="eyebrow">{monthLabel} performance snapshot</span><FileBarChart /></div><strong>{formatKsh(health.mtdIncome)}</strong><p>Recognized revenue for the current month</p>{health.revenueChange !== null ? <div className="report-trend">{health.revenueChange >= 0 ? <TrendingUp /> : <TrendingDown />}{Math.abs(health.revenueChange).toFixed(1)}% compared with last month</div> : <p className="panel-subtle">No prior-month data yet to compare against</p>}</div><div className="panel report-score"><div><span className="eyebrow">Business health score</span>{health.score !== null ? <strong>{health.score}<span>/100</span></strong> : <strong style={{ fontSize: "1.1rem" }}>Not enough data</strong>}<p>{health.score !== null ? `Averaged across ${health.scoredCount} of 4 tracked indicators` : "Add invoices, transactions, projects, or decided leads to see a score"}</p></div>{health.score !== null && <div className="score-orb"><span>{health.score}</span></div>}</div><div className="panel report-bars"><span className="eyebrow">Core indicators</span>{health.components.map((item) => <div className="report-bar" key={item.label}><span>{item.label}</span><div><i style={{ width: `${item.value ?? 0}%`, background: item.value !== null ? item.color : "rgba(255,255,255,.08)" }} /></div><strong>{item.value !== null ? `${Math.round(item.value)}%` : "-"}</strong></div>)}</div></section><WebsiteTrafficPanel /><div className="panel table-panel"><div className="panel-head"><h2 className="panel-title">Saved Reports</h2><button className="text-button" onClick={onCreate}>Create report</button></div><TableDiscovery placeholder="Search saved reports…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.visibleRows.length} reports found`} /><BulkActions selectedCount={selection.selected.size} options={discovery.options.filter((option) => option !== "All")} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible reports" /></th><th>Report</th><th>Category</th><th>Period</th><th>Delivery</th><th>Last Generated</th><th></th></tr></thead><tbody>{discovery.visibleRows.map(({ row: r, index }) => <tr key={`${r[0]}-${index}`}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td><Status label={r[3]} tone={statusTone(r[3])} /></td><td>{r[4]}</td><td><RecordActions onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div></div></div>; }

function AssistantPage({ invoices, inventory, projects, transactions }: { invoices: EditableRow[]; inventory: EditableRow[]; projects: EditableRow[]; transactions: EditableRow[] }) {
  const prompts = ["Which invoices need follow-up this week?", "What is low or out of stock?", "How are active projects progressing?", "What should I prioritize today?"];
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "assistant" | "member"; text: string }[]>([{ role: "assistant", text: "I’m ready to help with invoices, projects, inventory, and recent accounting activity. Ask a question or choose a suggested prompt." }]);
  const chat = trpc.insight.chat.useMutation({
    onSuccess: (result) => setMessages((current) => current.concat({ role: "assistant", text: result.answer })),
    onError: () => setMessages((current) => current.concat({ role: "assistant", text: "I couldn’t reach the server-side assistant just now. Please try again in a moment." })),
  });
  const respond = (question: string) => {
    const content = question.trim();
    if (!content || chat.isPending) return;
    const outgoing = messages.concat({ role: "member" as const, text: content });
    setMessages(outgoing);
    setInput("");
    chat.mutate({
      messages: outgoing.map((message) => ({ role: message.role === "assistant" ? "assistant" as const : "user" as const, content: message.text })),
      context: { invoices, inventory, projects, transactions },
    });
  };
  return <div className="page-content"><PageHeader title="AI Assistant" subtitle="Ask 4S Insight about your business operations" /><section className="assistant-grid"><div className="panel assistant-main"><div className="assistant-orb"><Bot /></div><span className="assistant-kicker">4S Insight · Operations copilot</span><h2>What needs your attention?</h2><p>Ask for practical operational analysis. Your workspace records are securely summarized for the server-side AI response.</p><div className="assistant-brief"><div><span><CircleAlert />Priority signal</span><strong>{invoices.filter((row) => /overdue/i.test(row[5] || "")).length || "No"} overdue invoices in the current table.</strong><button disabled={chat.isPending} onClick={() => respond("Which invoices need follow-up this week?")}>Review follow-up list <ChevronRight /></button></div><div><span><Lightbulb />Opportunity</span><strong>{inventory.filter((row) => /low stock|out of stock/i.test(row[6] || "")).length || "No"} inventory alerts need review.</strong><button disabled={chat.isPending} onClick={() => respond("What is low or out of stock?")}>Review stock risk <ChevronRight /></button></div></div><div className="assistant-chat" aria-live="polite">{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "4S Insight" : "You"}</span><p>{message.text}</p></div>)}{chat.isPending ? <div className="chat-message assistant" role="status" aria-live="polite"><span>4S Insight</span><p className="assistant-typing" aria-label="4S Insight is typing">Analyzing your workspace data<span className="typing-dots" aria-hidden="true"><i>·</i><i>·</i><i>·</i></span></p></div> : null}</div><div className="assistant-input"><Sparkles /><input disabled={chat.isPending} value={input} onChange={(event) => setInput(event.target.value)} aria-label="Ask 4S Insight" placeholder="Ask about clients, cash flow, projects, or performance…" onKeyDown={(event) => { if (event.key === "Enter") respond(input); }} /><button disabled={chat.isPending || !input.trim()} aria-label="Send question" onClick={() => respond(input)}><Send /></button></div></div><aside className="assistant-side"><div className="panel assistant-status"><div className="panel-head"><h2 className="panel-title">Data status</h2><span className="status active">Ready</span></div><div className="status-list"><div><Database /><span>Workspace records</span><strong>{invoices.length + inventory.length + projects.length + transactions.length}</strong></div><div><RefreshCw /><span>Response source</span><strong>Server AI</strong></div><div><HardDrive /><span>Persistence</span><strong>Workspace database</strong></div></div></div><div className="panel prompt-card"><span className="eyebrow">Suggested prompts</span>{prompts.map((prompt) => <button disabled={chat.isPending} key={prompt} onClick={() => respond(prompt)}>{prompt}<ChevronRight /></button>)}</div></aside></section></div>;
}

function SettingsWorkspace() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("Business profile");
  const tabs = [{ label: "Business profile", icon: Building2 }, { label: "Integrations", icon: Webhook }, { label: "My account", icon: UserRound }, { label: "Preferences", icon: SlidersHorizontal }, { label: "Notifications", icon: Activity }];
  const profileQuery = trpc.workspace.profile.useQuery(undefined, { enabled: Boolean(user) });
  const webhookQuery = trpc.workspace.leadWebhook.useQuery(undefined, { enabled: Boolean(user) && tab === "Integrations" && user?.role === "admin" });
  const [form, setForm] = useState({ name: "", currency: "KES" as "KES" | "USD", businessEmail: "", businessPhone: "", businessAddress: "" });
  useEffect(() => { if (profileQuery.data) setForm({ name: profileQuery.data.name, currency: (profileQuery.data.currency as "KES" | "USD") || "KES", businessEmail: profileQuery.data.businessEmail || "", businessPhone: profileQuery.data.businessPhone || "", businessAddress: profileQuery.data.businessAddress || "" }); }, [profileQuery.data]);
  const saveProfile = trpc.workspace.updateProfile.useMutation({
    onSuccess: () => { toast.success("Business profile saved"); utils.workspace.profile.invalidate(); },
    onError: (error) => toast.error(error.message),
  });
  const isAdmin = user?.role === "admin";
  const copy = (value: string, label: string) => { navigator.clipboard?.writeText(value).then(() => toast.success(`${label} copied`)).catch(() => toast.error("Could not copy")); };
  const curlSnippet = webhookQuery.data ? `curl -X POST "${webhookQuery.data.url}" \\\n  -H "Content-Type: application/json" \\\n  -H "X-Webhook-Secret: ${webhookQuery.data.secret}" \\\n  -d '{"name":"Jane Doe","email":"jane@example.com","phone":"+254700000000","message":"Interested in a website"}'` : "";
  const panel = tab === "Business profile" ? <div className="panel settings-card"><div className="settings-card-head"><div><h2>Business profile</h2><p>Details used on invoices, quotes, and reporting.</p></div><img src={logo} alt="45Creatives Agency" /></div>{profileQuery.isLoading ? <p className="panel-subtle">Loading…</p> : <div className="settings-fields"><label>Business name<input value={form.name} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></label><label>Primary email<input type="email" value={form.businessEmail} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, businessEmail: e.target.value }))} /></label><label>Phone number<input value={form.businessPhone} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, businessPhone: e.target.value }))} /></label><label>Currency<select value={form.currency} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as "KES" | "USD" }))}><option value="KES">KES - Kenyan shilling</option><option value="USD">USD - United States dollar</option></select></label><label className="wide">Business address<input value={form.businessAddress} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, businessAddress: e.target.value }))} /></label></div>}{!isAdmin && <p className="panel-subtle">Only workspace admins can edit the business profile.</p>}</div> : tab === "Integrations" ? <div className="panel settings-card"><h2>Website lead capture</h2><p>Send your website's contact-form submissions here and they'll show up as new Leads automatically - no manual re-entry.</p>{!isAdmin ? <p className="panel-subtle">Only workspace admins can view integration credentials.</p> : webhookQuery.isLoading ? <p className="panel-subtle">Loading…</p> : webhookQuery.data ? <div className="settings-fields"><label className="wide">Webhook URL<div className="contract-link-box"><Webhook size={12} /><span>{webhookQuery.data.url}</span><button className="text-button" type="button" onClick={() => copy(webhookQuery.data!.url, "Webhook URL")}><Copy size={11} />Copy</button></div></label><label className="wide">Secret (send as the <code>X-Webhook-Secret</code> header)<div className="contract-link-box"><ShieldCheck size={12} /><span>{webhookQuery.data.secret}</span><button className="text-button" type="button" onClick={() => copy(webhookQuery.data!.secret, "Secret")}><Copy size={11} />Copy</button></div></label><label className="wide">Example request<pre className="webhook-snippet">{curlSnippet}</pre></label></div> : null}<p className="panel-subtle">POST <code>{"{ name, email, phone, message, source }"}</code> as JSON from your site's form handler, a Zapier/Make webhook step, or a WordPress plugin like WPForms/Contact Form 7's webhook add-on - whatever your website runs on. Every submission becomes a new Lead with the source labeled "Website contact form", and you'll get an email notification if a business email is set on this workspace.</p></div> : tab === "My account" ? <div className="panel settings-card"><h2>My account</h2><p>Use the account access controls below to sign in, sign out, or remove your workspace account.</p></div> : tab === "Preferences" ? <div className="panel settings-card"><h2>Operational preferences</h2><div className="setting-switch-row"><div><strong>Compact tables</strong><span>Keep business records dense for operational scanning.</span></div><input type="checkbox" defaultChecked aria-label="Compact tables" /></div><div className="setting-switch-row"><div><strong>Local draft recovery</strong><span>Keep unsynced record edits available in this browser.</span></div><input type="checkbox" defaultChecked aria-label="Local draft recovery" /></div></div> : <div className="panel settings-card"><h2>Notification preferences</h2><div className="setting-switch-row"><div><strong>Invoice due reminders</strong><span>Notify the team three days before payment is due.</span></div><input type="checkbox" defaultChecked aria-label="Invoice due reminders" /></div><div className="setting-switch-row"><div><strong>Weekly executive summary</strong><span>Send a Monday morning performance briefing to admins.</span></div><input type="checkbox" defaultChecked aria-label="Weekly executive summary" /></div><div className="setting-switch-row"><div><strong>Stock threshold alerts</strong><span>Flag consumables and assets that need replenishing.</span></div><input type="checkbox" defaultChecked aria-label="Stock threshold alerts" /></div></div>;
  return <div className="page-content"><PageHeader title="Settings" subtitle="Manage your workspace, preferences, and integrations" action={tab === "Business profile" && isAdmin ? (saveProfile.isPending ? "Saving…" : "Save Changes") : undefined} onAction={tab === "Business profile" && isAdmin ? () => saveProfile.mutate(form) : undefined} /><section className="settings-layout"><div className="settings-tabs panel">{tabs.map(({ label, icon: Icon }) => <button key={label} className={tab === label ? "active" : ""} onClick={() => setTab(label)}><Icon />{label}</button>)}</div><div className="settings-content">{panel}</div></section></div>;
}
function PlaceholderPage({ page }: { page: string }) { const Icon = page === "AI Assistant" ? Sparkles : page === "Settings" ? Settings : page === "Inventory" ? Archive : ClipboardList; return <div className="page-content"><PageHeader title={page} subtitle="Your workspace is ready for the next workflow." /><div className="panel empty-page"><div><div className="empty-icon"><Icon /></div><h2>{page} workspace</h2><p>This operational area is staged and connected to the same dark management shell. Use the side navigation to explore live client, project, invoicing, and payment records.</p></div></div></div>; }

function AccountingBulkPage({ onNavigate, rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete }: { onNavigate: (p: PageKey) => void; rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) {
  const discovery = useTableDiscovery(rows, 3);
  const selection = useBulkSelection();
  const visibleIndices = discovery.visibleRows.map(({ index }) => index);
  const now = new Date();
  const isThisMonth = (row: EditableRow) => { const date = parseRowDate(row[0]); return date ? date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() : false; };
  const isLastMonth = (row: EditableRow) => { const date = parseRowDate(row[0]); const last = new Date(now.getFullYear(), now.getMonth() - 1, 1); return date ? date.getFullYear() === last.getFullYear() && date.getMonth() === last.getMonth() : false; };
  const mtdIncome = rows.filter((row) => row[5] === "positive" && isThisMonth(row)).reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const mtdExpense = rows.filter((row) => row[5] === "negative" && isThisMonth(row)).reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const lastMonthIncome = rows.filter((row) => row[5] === "positive" && isLastMonth(row)).reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const lastMonthExpense = rows.filter((row) => row[5] === "negative" && isLastMonth(row)).reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const revenueChange = lastMonthIncome > 0 ? ((mtdIncome - lastMonthIncome) / lastMonthIncome) * 100 : null;
  const profitChange = lastMonthIncome - lastMonthExpense !== 0 ? (((mtdIncome - mtdExpense) - (lastMonthIncome - lastMonthExpense)) / Math.abs(lastMonthIncome - lastMonthExpense)) * 100 : null;
  const profitData = useMemo(() => monthlySeriesFromTransactions(rows, 6), [rows]);
  return <div className="page-content"><PageHeader title="Accounting" subtitle="Monitor revenue, costs, and working capital" action="New Entry" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Revenue (MTD)" value={formatKsh(mtdIncome)} meta={revenueChange !== null ? `${revenueChange >= 0 ? "↑" : "↓"} ${Math.abs(revenueChange).toFixed(1)}% versus last month` : "No data for last month"} /><MetricCard label="Operating Expenses" value={formatKsh(mtdExpense)} meta={mtdIncome > 0 ? `${((mtdExpense / mtdIncome) * 100).toFixed(1)}% of revenue` : undefined} /><MetricCard label="Net Operating Profit" value={formatKsh(mtdIncome - mtdExpense)} meta={profitChange !== null ? `${profitChange >= 0 ? "↑" : "↓"} ${Math.abs(profitChange).toFixed(1)}% month on month` : "No data for last month"} tone="success" /></section><section className="accounting-grid"><div className="panel"><div className="panel-head"><h2 className="panel-title">Income vs. Expenses</h2><span className="panel-subtle">Last 6 months</span></div><div className="chart-wrap accounting-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={profitData} margin={{ top: 8, right: 5, left: -19, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} strokeDasharray="3 3" /><XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fill: "#9ca2a8", fontSize: 9 }} dy={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#9ca2a8", fontSize: 8 }} tickFormatter={(value) => `${value}K`} /><Area isAnimationActive={false} type="monotone" dataKey="revenue" stroke="#76c991" strokeWidth={2} fill="rgba(118,201,145,.12)" /><Area isAnimationActive={false} type="monotone" dataKey="expense" stroke="#df676a" strokeWidth={2} fill="rgba(223,103,106,.1)" /></AreaChart></ResponsiveContainer></div></div><div className="panel ledger-summary"><div className="panel-head"><h2 className="panel-title">Ledger Summary</h2><Landmark size={14} color="#a8afb5" /></div><div className="ledger-row"><span>Income (MTD)</span><strong>{formatKsh(mtdIncome)}</strong></div><div className="ledger-row"><span>Expenses (MTD)</span><strong>{formatKsh(mtdExpense)}</strong></div><div className="ledger-row ledger-total"><span>Cash movement</span><strong>{formatKsh(mtdIncome - mtdExpense)}</strong></div></div></section><div className="panel table-panel"><div className="panel-head"><h2 className="panel-title">Recent Transactions</h2><button className="text-button" onClick={() => onNavigate("Accounting")}>View ledger</button></div><TableDiscovery placeholder="Search transactions…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.visibleRows.length} transactions found`} /><BulkActions selectedCount={selection.selected.size} options={discovery.options.filter((option) => option !== "All")} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible transactions" /></th><th>Date</th><th>Reference</th><th>Description</th><th>Type</th><th>Amount</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={7} className="activity-empty">No transactions yet. Add your first entry to get started.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={`${r[0]}-${r[1]}-${index}`}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[1]}`} /></td><td>{r[0]}</td><td className="strong-cell">{r[1]}</td><td>{r[2]}</td><td><Status label={r[3]} tone={r[5] === "positive" ? "active" : "overdue"} /></td><td className={`value-cell ${r[5] === "negative" ? "danger" : ""}`}>{r[5] === "positive" ? "+" : "−"}{r[4]}</td><td><RecordActions onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div></div></div>;
}

function WorkspaceActivityTimeline() { const { user } = useAuth(); const activity = trpc.activity.list.useQuery({}, { enabled: user?.role === "admin", refetchInterval: 45_000, refetchIntervalInBackground: false }); const [query, setQuery] = useState(""); const [eventType, setEventType] = useState("All"); const [order, setOrder] = useState<"newest" | "oldest">("newest"); const [startDate, setStartDate] = useState(""); const [endDate, setEndDate] = useState(""); const eventTypes = useMemo(() => ["All", ...Array.from(new Set((activity.data || []).map((event) => event.action)))], [activity.data]); const events = useMemo(() => (activity.data || []).filter((event) => { const text = `${event.action} ${event.detail} ${event.tableName} ${event.recordId} ${event.actorName || ""} ${event.actorEmail || ""}`.toLowerCase(); const day = event.createdAt.toISOString().slice(0, 10); return (!query || text.includes(query.toLowerCase())) && (eventType === "All" || event.action === eventType) && (!startDate || day >= startDate) && (!endDate || day <= endDate); }).sort((left, right) => order === "newest" ? right.createdAt.getTime() - left.createdAt.getTime() : left.createdAt.getTime() - right.createdAt.getTime()), [activity.data, endDate, eventType, order, query, startDate]); const exportEvents = () => { const csv = [["Timestamp", "Actor", "Action", "Record", "Table", "Detail"], ...events.map((event) => [event.createdAt.toISOString(), event.actorName || event.actorEmail || `User ${event.actorUserId}`, event.action, event.recordId, event.tableName, event.detail])].map((row) => row.map(csvCell).join(",")).join("\n"); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const link = document.createElement("a"); link.href = url; link.download = "4s-workspace-activity.csv"; link.click(); URL.revokeObjectURL(url); toast.success(`${events.length} filtered activity events exported`); }; if (user?.role !== "admin") return null; return <section className="panel dashboard-timeline"><div className="panel-head"><div><h2 className="panel-title">Workspace activity</h2><p className="panel-subtle">Persisted record, role, and invitation events</p></div><Activity /></div><div className="timeline-controls"><label className="searchbox"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search activity…" aria-label="Search workspace activity" /></label><label className="date-filter">From<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} aria-label="Activity start date" /></label><label className="date-filter">To<input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} aria-label="Activity end date" /></label><select value={eventType} onChange={(event) => setEventType(event.target.value)} aria-label="Filter activity type">{eventTypes.map((type) => <option key={type}>{type}</option>)}</select><select value={order} onChange={(event) => setOrder(event.target.value as "newest" | "oldest")} aria-label="Sort activity"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select><button className="record-history" onClick={exportEvents} disabled={!events.length}><FileDown />Export CSV</button></div><div className="timeline-feed">{events.length ? events.slice(0, 20).map((event) => <div className="timeline-row" key={event.id}><i /><div><strong>{event.action}</strong><p>{event.detail}</p><span>{event.actorName || event.actorEmail || `User ${event.actorUserId}`} · {event.tableName} · {event.recordId} · {event.createdAt.toLocaleString()}</span></div></div>) : <p className="activity-empty">No matching shared activity was found.</p>}</div></section>; }

function RoleManagementPanel() {
  const { user } = useAuth();
  const users = trpc.admin.users.useQuery(undefined, { enabled: user?.role === "admin" });
  const invitations = trpc.admin.invitations.useQuery(undefined, { enabled: user?.role === "admin" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkRole, setBulkRole] = useState<"admin" | "member">("member");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const refresh = () => { users.refetch(); invitations.refetch(); };
  const setRole = trpc.admin.setRole.useMutation({ onSuccess: refresh, onError: (error) => toast.error(error.message) });
  const setRoles = trpc.admin.setRoles.useMutation({ onSuccess: ({ updated }) => { toast.success(`${updated} workspace role${updated === 1 ? "" : "s"} updated`); setSelected(new Set()); refresh(); }, onError: (error) => toast.error(error.message) });
  const invite = trpc.admin.invite.useMutation({ onSuccess: ({ invitation }) => { toast.success(`Invitation sent to ${invitation.email}`); setEmail(""); refresh(); }, onError: (error) => toast.error(error.message) });
  if (user?.role !== "admin") return null;
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const members = users.data || [];
  return <div className="page-content"><div className="panel settings-card role-admin-panel"><div className="settings-card-head"><div><h2>Role management</h2><p>Select team members for a bulk permission change, or send a role-specific workspace invitation.</p></div><Users /></div><div className="role-toolbar"><label><input type="checkbox" checked={members.length > 0 && members.every((member) => selected.has(member.id))} onChange={() => setSelected((current) => current.size === members.length ? new Set() : new Set(members.map((member) => member.id)))} />Select all</label><select value={bulkRole} onChange={(event) => setBulkRole(event.target.value as "admin" | "member")} aria-label="Bulk workspace role"><option value="member">User</option><option value="admin">Administrator</option></select><button disabled={!selected.size || setRoles.isPending} onClick={() => setRoles.mutate({ userIds: Array.from(selected), role: bulkRole })}>{setRoles.isPending ? <RefreshCw className="animate-spin" /> : <Check />}{setRoles.isPending ? "Updating roles…" : `Assign role to ${selected.size || "selected"}`}</button></div><div className="role-member-list">{members.map((member) => <div className="role-member" key={member.id}><input type="checkbox" checked={selected.has(member.id)} onChange={() => toggle(member.id)} aria-label={`Select ${member.name || member.email || member.id}`} /><span>{member.name || member.email || `User ${member.id}`}</span><small>{member.email || "No email recorded"}</small><select value={member.role} onChange={(event) => setRole.mutate({ userId: member.id, role: event.target.value as "admin" | "member" })}><option value="member">User</option><option value="admin">Administrator</option></select></div>) || <span>Loading workspace users…</span>}</div><form className="invite-form" onSubmit={(event) => { event.preventDefault(); invite.mutate({ email, role: inviteRole }); }}><div><h3>Invite a team member</h3><p>Send a secure workspace invitation through the configured delivery provider.</p></div><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="new.member@agency.com" aria-label="Invitee email" /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "admin" | "member")} aria-label="Invitee role"><option value="member">User</option><option value="admin">Administrator</option></select><button disabled={invite.isPending}>{invite.isPending ? <RefreshCw className="animate-spin" /> : <Send />}{invite.isPending ? "Sending invite…" : "Send invite"}</button></form><div className="invitation-history"><h3>Invitation delivery</h3>{invitations.data?.length ? invitations.data.slice(0, 6).map((invitation) => <div key={invitation.id}><span>{invitation.email}</span><small>{invitation.role}</small><Status label={invitation.status} tone={invitation.status === "accepted" ? "active" : invitation.status === "expired" || invitation.status === "revoked" ? "overdue" : "pending"} /></div>) : <p className="activity-empty">No invitations have been sent yet.</p>}</div></div></div>;
}

function AccountLifecyclePanel() { const { user, loading, logout, refresh } = useAuth(); const [profileOpen, setProfileOpen] = useState(false); const [name, setName] = useState(""); const [bio, setBio] = useState(""); useEffect(() => { const open = () => { if (!user) return; setName(user.name || ""); setBio(""); setProfileOpen(true); }; window.addEventListener("4s-open-profile", open); return () => window.removeEventListener("4s-open-profile", open); }, [user]); const profile = trpc.auth.profile.useQuery(undefined, { enabled: Boolean(user) }); const deleteAccount = trpc.auth.deleteAccount.useMutation({ onSuccess: async () => { toast.success("Account deleted"); await logout(); }, onError: (error) => toast.error(error.message) }); const updateProfile = trpc.auth.updateProfile.useMutation({ onSuccess: async () => { notifyProfileMutation(toast, "success"); await refresh(); profile.refetch(); setProfileOpen(false); }, onError: () => notifyProfileMutation(toast, "error") }); const uploadAvatar = trpc.auth.uploadAvatar.useMutation({ onSuccess: () => { toast.success("Profile picture updated"); profile.refetch(); }, onError: (error) => toast.error(error.message) }); const removeAvatar = trpc.auth.removeAvatar.useMutation({ onSuccess: () => { toast.success("Custom avatar removed"); profile.refetch(); }, onError: (error) => toast.error(error.message) }); const selectAvatar = (file?: File) => { if (!file) return; if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 2 * 1024 * 1024) { toast.error("Choose a PNG, JPEG, or WebP image under 2 MB."); return; } const reader = new FileReader(); reader.onload = () => uploadAvatar.mutate({ dataUrl: String(reader.result) }); reader.onerror = () => toast.error("Unable to read that image."); reader.readAsDataURL(file); }; if (!user) return <div className="page-content"><div className="panel settings-card account-panel"><h2>Account access</h2><p>Sign in to synchronize workspace data, manage roles, and access your account controls.</p><button className="heading-action" onClick={() => startLogin()} disabled={loading}>Sign in to workspace</button></div></div>; const avatar = profile.data?.avatarUrl || profile.data?.providerImageUrl || user.providerImageUrl || nadia; return <><div className="page-content"><div className="panel settings-card account-panel"><div><h2>Account access</h2><p>Signed in as {profile.data?.displayName || user.email || user.name || "workspace user"}.</p></div><div className="account-actions"><button className="record-history" onClick={() => { setName(profile.data?.displayName || user.name || ""); setBio(profile.data?.bio || ""); setProfileOpen(true); }}>Profile</button><button className="record-history" onClick={() => logout().catch((error) => toast.error(error instanceof Error ? error.message : "Unable to sign out"))} disabled={loading}>Sign out</button><button className="record-delete" onClick={() => { if (window.prompt("Type DELETE MY ACCOUNT to permanently remove your workspace account.") === "DELETE MY ACCOUNT") deleteAccount.mutate({ confirmation: "DELETE MY ACCOUNT" }); }} disabled={deleteAccount.isPending}>Delete account</button></div></div></div>{profileOpen ? <div className="record-dialog-backdrop" onMouseDown={() => setProfileOpen(false)}><section className="record-dialog panel" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(event) => event.stopPropagation()}><div className="record-dialog-head"><div><span className="eyebrow">Workspace profile</span><h2 id="profile-title">Your profile</h2></div><button className="record-close" onClick={() => setProfileOpen(false)}><X /></button></div><div className="record-fields"><label className="wide">Profile picture<div className="profile-avatar-picker"><img src={avatar} alt="Current profile avatar" /><input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadAvatar.isPending || removeAvatar.isPending} onChange={(event) => selectAvatar(event.target.files?.[0])} />{uploadAvatar.isPending || removeAvatar.isPending ? <RefreshCw className="animate-spin" /> : <span>Choose image</span>}</div><button className="record-reset" type="button" disabled={!profile.data?.avatarUrl || removeAvatar.isPending} onClick={() => removeAvatar.mutate()}>Remove custom avatar</button></label><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="wide">Short bio<textarea value={bio} maxLength={240} rows={3} placeholder="A short introduction for your workspace profile" onChange={(event) => setBio(event.target.value)} /></label><label>Assigned role<input value={profile.data?.role || user.role} readOnly /></label><label className="wide">Email<input value={user.email || "Not available"} readOnly /></label><label className="wide">Last sign-in<input value={profile.data?.lastSignedIn ? new Date(profile.data.lastSignedIn).toLocaleString() : "Not available"} readOnly /></label></div><div className="record-dialog-actions"><button className="record-reset" onClick={() => setProfileOpen(false)}>Cancel</button><button className="record-save" disabled={updateProfile.isPending || !name.trim()} onClick={() => updateProfile.mutate(buildProfileUpdateInput(name, bio))}>{updateProfile.isPending ? "Saving…" : "Save profile"}</button></div></section></div> : null}</>; }

export default function Home() {
  const { user } = useAuth();
  const [page, setPage] = useState<PageKey>(() => {
    const requestedView = new URLSearchParams(window.location.search).get("view") as PageKey | null;
    return requestedView && knownPages.has(requestedView) ? requestedView : "Dashboard";
  });
  const [query, setQuery] = useState("");
  const [selectedClientIndex, setSelectedClientIndex] = useState<number | null>(null);
  const [selectedInvoiceIndex, setSelectedInvoiceIndex] = useState<number | null>(null);
  const [clientRows, setClientRows] = useStoredRows("4s-creatives:clients", emptyRows);
  const [leadRows, setLeadRows] = useStoredRows("4s-creatives:leads", emptyRows);
  const [projectRows, setProjectRows] = useStoredRows("4s-creatives:projects", emptyRows);
  const [quoteRows, setQuoteRows] = useStoredRows("4s-creatives:quotes", emptyRows);
  const [invoiceRows, setInvoiceRows] = useStoredRows("4s-creatives:invoices", emptyRows);
  const [paymentRows, setPaymentRows] = useStoredRows("4s-creatives:payments", emptyRows);
  const [inventoryRows, setInventoryRows] = useStoredRows("4s-creatives:inventory", emptyRows);
  const [transactionRows, setTransactionRows] = useStoredRows("4s-creatives:transactions", emptyRows);
  const [reportRows, setReportRows] = useStoredRows("4s-creatives:reports", emptyRows);
  const [deletedRecords, setDeletedRecords] = useStoredDeletedRecords("4s-creatives:recently-deleted");
  const [activityEvents, setActivityEvents] = useStoredActivity("4s-creatives:activity-history");
  const [historyLabel, setHistoryLabel] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [syncConflict, setSyncConflict] = useState(false);
  const syncRecords = trpc.records.sync.useMutation({ onError: () => setSyncConflict(true), onSuccess: () => setSyncConflict(false) });
  const removeRecords = trpc.records.remove.useMutation({ onError: (error) => toast.error(`Database delete failed: ${error.message}`) });
  const syncActivity = trpc.activity.append.useMutation();
  const sharedRecords = trpc.records.list.useQuery(undefined, { enabled: Boolean(user) });
  const sharedActivity = trpc.activity.list.useQuery({}, { enabled: user?.role === "admin" });
  useEffect(() => { if (!sharedRecords.data?.length) return; const grouped = new Map<string, EditableRow[]>(); sharedRecords.data.forEach((record) => grouped.set(record.tableName, [...(grouped.get(record.tableName) || []), [...record.recordData, `${recordMarker}${record.id}`]])); const apply = (name: string, setter: Dispatch<SetStateAction<EditableRow[]>>) => { const rows = grouped.get(name); if (rows) setter(rows); }; apply("clients", setClientRows); apply("leads", setLeadRows); apply("projects", setProjectRows); apply("quotes", setQuoteRows); apply("invoices", setInvoiceRows); apply("payments", setPaymentRows); apply("inventory", setInventoryRows); apply("transactions", setTransactionRows); }, [sharedRecords.data]);
  useEffect(() => { if (!sharedActivity.data) return; setActivityEvents((current) => current.length ? current : sharedActivity.data.map((event) => ({ id: event.id, recordId: event.recordId, label: event.recordId, table: event.tableName, action: event.action, detail: event.detail, at: event.createdAt.getTime(), synced: true }))); }, [sharedActivity.data]);
  const previousRows = useRef<Record<string, string>>( {} );
  useEffect(() => { if (!user || sharedRecords.isLoading) return; const tableRows = [["clients", clientRows], ["leads", leadRows], ["projects", projectRows], ["quotes", quoteRows], ["invoices", invoiceRows], ["payments", paymentRows], ["inventory", inventoryRows], ["transactions", transactionRows]] as const; const changed = tableRows.flatMap(([tableName, rows]) => { const signature = JSON.stringify(rows); if (previousRows.current[tableName] === signature) return []; previousRows.current[tableName] = signature; return rows.map((row) => ({ id: getRecordId(row) || createRecordId(tableName), tableName, recordData: row.filter((cell) => !isRecordId(cell)) })); }); if (changed.length) syncRecords.mutate(changed); }, [user, sharedRecords.isLoading, clientRows, leadRows, projectRows, quoteRows, invoiceRows, paymentRows, inventoryRows, transactionRows]);
  // `synced` is stored on each event (persisted to localStorage via useStoredActivity) rather than
  // kept in separate component state, so a page reload doesn't forget what was already synced and
  // re-send the entire local history - up to 200 events - to the server every time the app loads.
  useEffect(() => { if (!user || syncActivity.isPending) return; const pending = activityEvents.filter((event) => !event.synced); if (!pending.length) return; syncActivity.mutate(pending.map((event) => ({ id: event.id, recordId: event.recordId, tableName: event.table, action: event.action, detail: event.detail })), { onSuccess: () => setActivityEvents((current) => current.map((event) => pending.some((p) => p.id === event.id) ? { ...event, synced: true } : event)), onError: (error) => toast.error(`Activity sync will retry: ${error.message.slice(0, 160)}`) }); }, [user, activityEvents, syncActivity.isPending]);
  const recordActivity = (label: string, table: string, action: string, detail: string, recordId = `${table}:${label}`) => setActivityEvents((current) => [{ id: `${table}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, recordId, label, table, action, detail, at: Date.now(), synced: false }, ...current].slice(0, 200));
  const openEditor = (title: string, labels: string[], row: EditableRow, onSave: (next: EditableRow, recordId: string) => void) => { const recordId = getRecordId(row) || createRecordId(title.replace(/^new\s+/i, "")); setEditor({ title, labels, row, onSave: (next) => { onSave(next, recordId); const creating = title.toLowerCase().startsWith("new "); recordActivity(next[0] || title, title.replace(/^new\s+/i, ""), creating ? "Created" : "Updated", creating ? "Record created from the local editor." : "Record fields updated from the local editor.", recordId); } }); };
  const deleteRecord = (label: string, table: string, row: EditableRow, index: number, setRows: Dispatch<SetStateAction<EditableRow[]>>) => { if (window.confirm(`Delete this ${label}? You can recover it from the recent deletion tray.`)) { setRows((current) => current.filter((_, rowIndex) => rowIndex !== index)); const recordId = getRecordId(row); if (recordId) removeRecords.mutate({ tableName: table, ids: [recordId] }); setDeletedRecords((current) => [{ id: `${table}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, label: row[0] || label, table, row, index, deletedAt: Date.now() }, ...current].slice(0, 8)); recordActivity(row[0] || label, table, "Deleted", "Moved to recently deleted records.", getRecordId(row) || `${table}:${row[0] || label}`); toast.success(`${label[0].toUpperCase()}${label.slice(1)} deleted`); } };
  const bulkUpdateRows = (setRows: Dispatch<SetStateAction<EditableRow[]>>, indices: number[], update: (row: EditableRow) => EditableRow) => { const selected = new Set(indices); setRows((current) => current.map((row, index) => selected.has(index) ? update(row) : row)); recordActivity(`${indices.length} selected records`, "bulk", "Bulk updated", "Updated through the selected-record bulk action."); toast.success(`${indices.length} records updated`); };
  const bulkDeleteRecords = (label: string, table: string, rows: EditableRow[], indices: number[], setRows: Dispatch<SetStateAction<EditableRow[]>>) => { if (!indices.length || !window.confirm(`Delete ${indices.length} ${label}${indices.length === 1 ? "" : "s"}? Each can be recovered from the recent deletion tray.`)) return; const selected = new Set(indices); const deleted = indices.map((index) => ({ row: rows[index], index })).filter((item): item is { row: EditableRow; index: number } => Boolean(item.row)); setRows((current) => current.filter((_, index) => !selected.has(index))); const idsToDelete = deleted.map((item) => getRecordId(item.row)).filter(Boolean); if (idsToDelete.length) removeRecords.mutate({ tableName: table, ids: idsToDelete }); setDeletedRecords((current) => deleted.map((item, position) => ({ id: `${table}-${Date.now()}-${position}`, label: item.row[0] || label, table, row: item.row, index: item.index, deletedAt: Date.now() })).concat(current).slice(0, 8)); deleted.forEach((item) => recordActivity(item.row[0] || label, table, "Deleted", "Deleted through the selected-record bulk action.")); toast.success(`${indices.length} records deleted`); };
  const restoreRecord = (record: DeletedRecord) => { const insertRecord = (setRows: Dispatch<SetStateAction<EditableRow[]>>) => setRows((current) => { const next = [...current]; next.splice(Math.min(record.index, next.length), 0, record.row); return next; }); switch (record.table) { case "clients": insertRecord(setClientRows); break; case "leads": insertRecord(setLeadRows); break; case "projects": insertRecord(setProjectRows); break; case "quotes": insertRecord(setQuoteRows); break; case "invoices": insertRecord(setInvoiceRows); break; case "payments": insertRecord(setPaymentRows); break; case "inventory": insertRecord(setInventoryRows); break; case "transactions": insertRecord(setTransactionRows); break; case "reports": insertRecord(setReportRows); break; default: return; } setDeletedRecords((current) => current.filter((item) => item.id !== record.id)); recordActivity(record.label, record.table, "Restored", "Recovered from recently deleted records.", getRecordId(record.row) || `${record.table}:${record.label}`); toast.success(`${record.label} restored`); };
  useEffect(() => { const onHistory = (event: Event) => setHistoryLabel((event as CustomEvent<{ label: string }>).detail.label); const onCsvImport = (event: Event) => { const { page: targetPage, rows } = (event as CustomEvent<{ page: string; rows: EditableRow[] }>).detail; const usable = rows.filter((row) => row.length > 0); if (!usable.length) return; const imported = (table: string, transform: (row: EditableRow) => EditableRow, setter: Dispatch<SetStateAction<EditableRow[]>>) => { const next = usable.map(transform); setter((current) => current.concat(next)); next.forEach((row) => recordActivity(row[0] || table, table, "Imported", "Added from a CSV import.")); }; switch (targetPage) { case "Clients": imported("clients", (row) => [...row.slice(0, 6), statusTone(row[5] || "Active")], setClientRows); break; case "Leads": imported("leads", (row) => [...row.slice(0, 5), statusTone(row[4] || "New"), row[5] || "Unassigned"], setLeadRows); break; case "Projects": imported("projects", (row) => [row[0] || "New Project", row[1] || "Client", row[2] || "0", row[3] || "In Progress", statusTone(row[3] || "In Progress"), row[4] || dateLabel, row[5] || "KSh 0"], setProjectRows); break; case "Quotes": imported("quotes", (row) => [...row.slice(0, 5), statusTone(row[4] || "Draft"), row[5] || dateLabel], setQuoteRows); break; case "Invoices": imported("invoices", (row) => [...row.slice(0, 6), statusTone(row[5] || "Pending")], setInvoiceRows); break; case "Payments": imported("payments", (row) => [...row.slice(0, 7), statusTone(row[6] || "Completed")], setPaymentRows); break; case "Inventory": imported("inventory", (row) => [...row.slice(0, 7), statusTone(row[6] || "In Stock")], setInventoryRows); break; case "Accounting": imported("transactions", (row) => [...row.slice(0, 5), (row[3] || "").toLowerCase().includes("income") ? "positive" : "negative"], setTransactionRows); break; case "Reports": imported("reports", (row) => [...row.slice(0, 5), "View"], setReportRows); break; default: return; } }; window.addEventListener("4s-record-history", onHistory as EventListener); window.addEventListener("4s-csv-import", onCsvImport as EventListener); return () => { window.removeEventListener("4s-record-history", onHistory as EventListener); window.removeEventListener("4s-csv-import", onCsvImport as EventListener); }; }, []);
  const dateLabel = new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  const content = (() => { switch (page) {
    case "Dashboard": return <DashboardPage onNavigate={setPage} clientRows={clientRows} invoiceRows={invoiceRows} transactionRows={transactionRows} projectRows={projectRows} inventoryRows={inventoryRows} />;
    case "Clients": return <ClientsPage onView={(index) => { setSelectedClientIndex(index); setPage("Client Details"); }} query={query} rows={clientRows} onEdit={(index) => openEditor("client", ["Client name", "Primary contact", "Email", "Phone", "Outstanding amount", "Status"], clientRows[index].slice(0, 6), (next) => updateStoredRow(setClientRows, index, [...next, statusTone(next[5])]))} onCreate={() => openEditor("new client", ["Client name", "Primary contact", "Email", "Phone", "Outstanding amount", "Status"], ["New Client", "Primary Contact", "client@example.com", "+254 700 000 000", "KSh 0", "Active"], (next) => setClientRows((current) => [...current, [...next, statusTone(next[5])]]))} onDelete={(index) => deleteRecord("client", "clients", clientRows[index], index, setClientRows)} onBulkEdit={(indices, value) => bulkUpdateRows(setClientRows, indices, (row) => [...row.slice(0, 5), value, statusTone(value)])} onBulkDelete={(indices) => bulkDeleteRecords("client", "clients", clientRows, indices, setClientRows)} />;
    case "Leads": return <LeadsPage rows={leadRows} onEdit={(index) => openEditor("lead", ["Lead name", "Company", "Source", "Estimated value", "Status", "Assigned to"], [...leadRows[index].slice(0, 5), leadRows[index][6]], (next) => updateStoredRow(setLeadRows, index, [...next.slice(0, 5), statusTone(next[4]), next[5]]))} onCreate={() => openEditor("new lead", ["Lead name", "Company", "Source", "Estimated value", "Status", "Assigned to"], ["New Lead", "Company", "Website", "KSh 0", "New", "Nadia Rachel"], (next) => setLeadRows((current) => [...current, [...next.slice(0, 5), statusTone(next[4]), next[5]]]))} onDelete={(index) => deleteRecord("lead", "leads", leadRows[index], index, setLeadRows)} onBulkEdit={(indices, value) => bulkUpdateRows(setLeadRows, indices, (row) => [...row.slice(0, 4), value, statusTone(value), row[6]])} onBulkDelete={(indices) => bulkDeleteRecords("lead", "leads", leadRows, indices, setLeadRows)} />;
    case "Projects": return <ProjectsPage rows={projectRows} onEdit={(index) => openEditor("project", ["Project name", "Client", "Progress (%)", "Status", "Due date", "Value"], [...projectRows[index].slice(0, 4), projectRows[index][5], projectRows[index][6]], (next) => updateStoredRow(setProjectRows, index, [...next.slice(0, 4), statusTone(next[3]), next[4], next[5]]))} onCreate={() => openEditor("new project", ["Project name", "Client", "Progress (%)", "Status", "Due date", "Value"], ["New Project", "Client", "0", "In Progress", dateLabel, "KSh 0"], (next) => setProjectRows((current) => [...current, [...next.slice(0, 4), statusTone(next[3]), next[4], next[5]]]))} onDelete={(index) => deleteRecord("project", "projects", projectRows[index], index, setProjectRows)} onBulkEdit={(indices, value) => bulkUpdateRows(setProjectRows, indices, (row) => [...row.slice(0, 3), value, statusTone(value), row[5], row[6]])} onBulkDelete={(indices) => bulkDeleteRecords("project", "projects", projectRows, indices, setProjectRows)} />;
    case "Quotes": return <QuotesPage rows={quoteRows} onEdit={(index) => openEditor("quote", ["Quote number", "Client", "Project", "Value", "Status", "Valid until"], [...quoteRows[index].slice(0, 5), quoteRows[index][6]], (next) => updateStoredRow(setQuoteRows, index, [...next.slice(0, 5), statusTone(next[4]), next[5]]))} onCreate={() => { openEditor("new quote", ["Quote number", "Client", "Project", "Value", "Status", "Valid until"], [`QT-2025-${String(quoteRows.length + 46).padStart(3, "0")}`, "Client", "New Project", "KSh 0", "Draft", dateLabel], (next) => { setQuoteRows((current) => current.concat([[...next.slice(0, 5), statusTone(next[4]), next[5]]])); }); }} onDelete={(index) => deleteRecord("quote", "quotes", quoteRows[index], index, setQuoteRows)} onBulkEdit={(indices, value) => bulkUpdateRows(setQuoteRows, indices, (row) => [...row.slice(0, 4), value, statusTone(value), row[6]])} onBulkDelete={(indices) => bulkDeleteRecords("quote", "quotes", quoteRows, indices, setQuoteRows)} />;
    case "Invoices": return <InvoicesPage onView={(index) => { setSelectedInvoiceIndex(index); setPage("Invoice Details"); }} rows={invoiceRows} onEdit={(index) => openEditor("invoice", ["Invoice number", "Client", "Issue date", "Due date", "Amount", "Status"], invoiceRows[index].slice(0, 6), (next) => updateStoredRow(setInvoiceRows, index, [...next, statusTone(next[5])]))} onCreate={() => openEditor("new invoice", ["Invoice number", "Client", "Issue date", "Due date", "Amount", "Status"], [`INV-2025-${String(invoiceRows.length + 105).padStart(3, "0")}`, "Client", dateLabel, dateLabel, "KSh 0", "Pending"], (next) => setInvoiceRows((current) => [...current, [...next, statusTone(next[5])]]))} onDelete={(index) => deleteRecord("invoice", "invoices", invoiceRows[index], index, setInvoiceRows)} onBulkEdit={(indices, value) => bulkUpdateRows(setInvoiceRows, indices, (row) => [...row.slice(0, 5), value, statusTone(value)])} onBulkDelete={(indices) => bulkDeleteRecords("invoice", "invoices", invoiceRows, indices, setInvoiceRows)} />;
    case "Payments": return <PaymentsPage rows={paymentRows} onEdit={(index) => openEditor("payment", ["Payment number", "Client", "Invoice", "Date", "Amount", "Method", "Status"], paymentRows[index].slice(0, 7), (next) => updateStoredRow(setPaymentRows, index, [...next, statusTone(next[6])]))} onCreate={() => openEditor("new payment", ["Payment number", "Client", "Invoice", "Date", "Amount", "Method", "Status"], [`PAY-2025-${String(paymentRows.length + 88).padStart(3, "0")}`, "Client", "INV-2025-000", dateLabel, "KSh 0", "M-Pesa", "Completed"], (next) => setPaymentRows((current) => [...current, [...next, statusTone(next[6])]]))} onDelete={(index) => deleteRecord("payment", "payments", paymentRows[index], index, setPaymentRows)} onBulkEdit={(indices, value) => bulkUpdateRows(setPaymentRows, indices, (row) => [...row.slice(0, 6), value, statusTone(value)])} onBulkDelete={(indices) => bulkDeleteRecords("payment", "payments", paymentRows, indices, setPaymentRows)} />;
    case "Inventory": return <InventoryPage rows={inventoryRows} onEdit={(index) => openEditor("inventory item", ["Item", "Category", "SKU", "Quantity", "Unit cost", "Stock value", "Status"], inventoryRows[index].slice(0, 7), (next) => updateStoredRow(setInventoryRows, index, [...next, statusTone(next[6])]))} onCreate={() => openEditor("new inventory item", ["Item", "Category", "SKU", "Quantity", "Unit cost", "Stock value", "Status"], ["New Asset", "Accessories", `AST-${String(inventoryRows.length + 1).padStart(3, "0")}`, "1", "KSh 0", "KSh 0", "In Stock"], (next) => setInventoryRows((current) => [...current, [...next, statusTone(next[6])]]))} onDelete={(index) => deleteRecord("inventory item", "inventory", inventoryRows[index], index, setInventoryRows)} onBulkEdit={(indices, value) => bulkUpdateRows(setInventoryRows, indices, (row) => [...row.slice(0, 6), value, statusTone(value)])} onBulkDelete={(indices) => bulkDeleteRecords("inventory item", "inventory", inventoryRows, indices, setInventoryRows)} />;
    case "Accounting": return <AccountingBulkPage onNavigate={setPage} rows={transactionRows} onEdit={(index) => openEditor("transaction", ["Date", "Reference", "Description", "Type", "Amount"], transactionRows[index].slice(0, 5), (next) => updateStoredRow(setTransactionRows, index, [...next, next[3].toLowerCase().includes("income") ? "positive" : "negative"]))} onCreate={() => openEditor("new transaction", ["Date", "Reference", "Description", "Type", "Amount"], [dateLabel, "New entry", "Description", "Income", "KSh 0"], (next) => setTransactionRows((current) => [...current, [...next, next[3].toLowerCase().includes("income") ? "positive" : "negative"]]))} onDelete={(index) => deleteRecord("transaction", "transactions", transactionRows[index], index, setTransactionRows)} onBulkEdit={(indices, value) => bulkUpdateRows(setTransactionRows, indices, (row) => [...row.slice(0, 3), value, row[4], value.toLowerCase().includes("income") ? "positive" : "negative"])} onBulkDelete={(indices) => bulkDeleteRecords("transaction", "transactions", transactionRows, indices, setTransactionRows)} />;
    case "Contracts": return <ContractsPage />;
    case "Reports": return <ReportsPage rows={reportRows} invoiceRows={invoiceRows} transactionRows={transactionRows} projectRows={projectRows} leadRows={leadRows} onEdit={(index) => openEditor("saved report", ["Report name", "Category", "Period", "Delivery", "Last generated"], reportRows[index].slice(0, 5), (next) => updateStoredRow(setReportRows, index, [...next, reportRows[index][5]]))} onCreate={() => openEditor("new saved report", ["Report name", "Category", "Period", "Delivery", "Last generated"], ["New Report", "Operations", "May 2025", "On demand", dateLabel], (next) => setReportRows((current) => [...current, [...next, "View"]]))} onDelete={(index) => deleteRecord("saved report", "reports", reportRows[index], index, setReportRows)} onBulkEdit={(indices, value) => bulkUpdateRows(setReportRows, indices, (row) => [...row.slice(0, 3), value, row[4], row[5]])} onBulkDelete={(indices) => bulkDeleteRecords("saved report", "reports", reportRows, indices, setReportRows)} />;
    case "AI Assistant": return <AssistantPage invoices={invoiceRows} inventory={inventoryRows} projects={projectRows} transactions={transactionRows} />;
    case "Settings": return <><SettingsWorkspace /><RoleManagementPanel /><AccountLifecyclePanel /></>;
    case "Client Details": return <ClientDetails client={selectedClientIndex !== null ? clientRows[selectedClientIndex] ?? null : null} projectRows={projectRows} invoiceRows={invoiceRows} onBack={() => setPage("Clients")} />;
    case "Invoice Details": return <InvoiceDetails invoice={selectedInvoiceIndex !== null ? invoiceRows[selectedInvoiceIndex] ?? null : null} clientRows={clientRows} onBack={() => setPage("Invoices")} onRecordPayment={(inv) => { const balance = Math.max(0, parseAmount(inv[4]) - (inv[5] === "paid" ? parseAmount(inv[4]) : 0)); openEditor("new payment", ["Payment number", "Client", "Invoice", "Date", "Amount", "Method", "Status"], [`PAY-${Date.now().toString().slice(-6)}`, inv[1], inv[0], dateLabel, `KSh ${balance || parseAmount(inv[4])}`, "M-Pesa", "Completed"], (next) => setPaymentRows((current) => [...current, [...next, statusTone(next[6])]])); }} />;
    default: return <PlaceholderPage page={page} />;
  } })();
  return <main className="dashboard-app"><Sidebar active={page} onNavigate={(next) => { setPage(next); setQuery(""); }} /><section className="workspace"><Topbar query={query} onQuery={setQuery} onNavigate={(next) => { setPage(next); setQuery(""); }} /><div className="sync-state" role="status">{!user ? "Local draft - sign in to sync" : syncRecords.isPending ? "Syncing shared workspace…" : syncConflict ? "Sync conflict detected" : "Shared workspace synced"}</div>{syncConflict ? <div className="panel sync-conflict"><strong>We could not save your latest changes.</strong><span>Keep your local version and retry, or reload the server version.</span><button onClick={() => syncRecords.reset()}>Keep local changes</button><button onClick={() => { sharedRecords.refetch(); setSyncConflict(false); }}>Use server version</button></div> : null}{content}{page === "Dashboard" ? <WorkspaceActivityTimeline /> : null}</section><RecordEditor editor={editor} onClose={() => setEditor(null)} /><ActivityHistoryDialog label={historyLabel} events={activityEvents} onClose={() => setHistoryLabel(null)} /><RecoveryTray records={deletedRecords} onUndo={restoreRecord} onDismiss={(id) => setDeletedRecords((current) => current.filter((record) => record.id !== id))} /></main>;
}
