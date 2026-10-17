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
import RenewalsPage from "@/components/RenewalsPage";
import QuoteViewDialog from "@/components/QuoteViewDialog";
import ProjectWorkspace from "@/components/ProjectWorkspace";
import ClientVault from "@/components/ClientVault";
import MpesaPanel from "@/components/MpesaPanel";
import { BillingSettings, MpesaIntegration } from "@/components/SettingsBilling";
import { daysUntil, renewalUrgency } from "@shared/renewal";
import InvoiceDetailsDialog from "@/components/InvoiceDetailsDialog";
import InvoiceViewDialog, { invoiceStatusTone, type InvoicePaymentTarget } from "@/components/InvoiceViewDialog";
import { defaultInvoiceFields, formatInvoiceMoney, nextInvoiceNumberFrom, type InvoiceFields } from "@shared/invoice";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { toast } from "sonner";
import {
  Activity, Archive, ArrowDownRight, ArrowLeft, ArrowUpRight, Bell, Bot, BookOpen,
  Box, BriefcaseBusiness, Building2, CalendarClock, CalendarDays, Check, CheckCircle2, ChevronRight,
  CircleAlert, CircleDollarSign, ClipboardList, Copy, CreditCard, Database, Eraser, ExternalLink, FileBarChart,
  FileDown, FileSignature, FileText, FolderKanban, HardDrive, Headphones, Landmark, Lightbulb,
  LayoutDashboard, LogOut, Mail, MessageCircle, Package, Pencil, PenTool, Phone, Plus, ReceiptText, RefreshCw, Search, Send,
  Settings, ShieldCheck, SlidersHorizontal, Sparkles, TrendingDown, TrendingUp, UserRound, Users,
  Trash2, Undo2, WalletCards, Warehouse, X, History, Webhook, Globe, Printer,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { ContractFields } from "@shared/contract";

type PageKey = "Dashboard" | "Clients" | "Leads" | "Projects" | "Quotes" | "Invoices" | "Payments" | "Inventory" | "Accounting" | "Contracts" | "Renewals" | "Reports" | "AI Assistant" | "Settings" | "Client Details";
type StatusTone = "active" | "paid" | "completed" | "accepted" | "overdue" | "expired" | "negative" | "pending" | "draft" | "new" | "sent" | "in-progress" | "proposal";
type EditableRow = string[];
/** Per-field choices: `strict` renders a select (fixed database values), otherwise suggestions. */
type FieldOptions = Record<number, { values: string[]; strict?: boolean }>;
type EditorState = { title: string; labels: string[]; row: EditableRow; onSave: (next: EditableRow) => void; readOnly?: number[]; options?: FieldOptions };
type DeletedRecord = { id: string; label: string; table: string; row: EditableRow; index: number; deletedAt: number };
type ActivityEvent = { id: string; recordId: string; label: string; table: string; action: string; detail: string; at: number; synced?: boolean };

const logo = "/assets/45creatives-logo.png";
const nadia = "/assets/avatar-nadia.svg";
const john = "/assets/avatar-john.svg";

const navItems: { label: Exclude<PageKey, "Client Details">; icon: typeof LayoutDashboard }[] = [
  { label: "Dashboard", icon: LayoutDashboard }, { label: "Clients", icon: Users }, { label: "Leads", icon: UserRound },
  { label: "Projects", icon: FolderKanban }, { label: "Quotes", icon: FileText }, { label: "Invoices", icon: ReceiptText },
  { label: "Payments", icon: WalletCards }, { label: "Inventory", icon: Package }, { label: "Accounting", icon: BookOpen },
  { label: "Contracts", icon: FileSignature }, { label: "Renewals", icon: CalendarClock },
  { label: "Reports", icon: Activity }, { label: "AI Assistant", icon: Sparkles }, { label: "Settings", icon: Settings },
];

const knownPages = new Set<PageKey>([...navItems.map((item) => item.label), "Client Details"]);

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

/** The next number in a "PREFIX-001" style sequence. Numbers are unique per workspace in the
 * database, so this continues from the highest one in use rather than from the row count
 * (which repeats a number as soon as a record is deleted and makes the save fail). */
function nextSequenceNumber(prefix: string, existing: string[], width = 3) {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\d+)$`);
  const highest = existing.reduce((max, value) => { const match = pattern.exec((value || "").trim()); return match ? Math.max(max, Number(match[1])) : max; }, 0);
  return `${prefix}${String(highest + 1).padStart(width, "0")}`;
}

/** Allowed values for the status-like columns. The database stores these as fixed values, so the
 * editor offers them as a list instead of free text that would silently fall back to a default. */
const clientStatusOptions = ["Active", "Pending", "Inactive"];
const leadStatusOptions = ["New", "Contacted", "Qualified", "Proposal", "Negotiation", "Won", "Lost", "Nurturing"];
const projectStatusOptions = ["Planning", "In Progress", "On Hold", "Completed", "Cancelled"];
const quoteStatusOptions = ["Draft", "Sent", "Accepted", "Declined", "Expired"];
const paymentStatusOptions = ["Completed", "Pending", "Failed", "Refunded"];
const paymentMethodOptions = ["M-Pesa", "Bank transfer", "Card", "Cash", "PayPal", "Cheque"];
const transactionTypeOptions = ["Income", "Expense", "Transfer"];
const transactionSign = (type: string) => { const t = (type || "").toLowerCase(); return t.includes("income") ? "positive" : t.includes("transfer") ? "neutral" : "negative"; };
const inventoryStock = (quantity: string) => { const qty = Math.max(0, Number(quantity) || 0); return qty === 0 ? "Out of Stock" : qty <= 1 ? "Low Stock" : "In Stock"; };

const recordMarker = "__4s_record_id:";
function isRecordId(value: string | undefined) { return Boolean(value?.startsWith(recordMarker)); }
function getRecordId(row: EditableRow) { const candidate = row[row.length - 1]; return isRecordId(candidate) ? candidate.slice(recordMarker.length) : ""; }
/** A v4 UUID. `crypto.randomUUID` only exists on HTTPS/localhost, so on plain-HTTP LAN access we
 * build one from `getRandomValues` - the server only keeps ids that are real UUIDs, and anything
 * else would be saved as a brand-new record on every sync. */
function createRecordId(_key: string) {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
// Returns the same array when every row already has an id, so rows loaded from the server keep
// their identity and the sync effect can tell them apart from local edits.
function ensureRecordIds(key: string, rows: EditableRow[]) { return rows.every((row) => isRecordId(row[row.length - 1])) ? rows : rows.map((row) => isRecordId(row[row.length - 1]) ? row : [...row, `${recordMarker}${createRecordId(key)}`]); }
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

// Keeps empty cells: rows are positional, so dropping a blank field would shift every later column.
function updateStoredRow(setRows: Dispatch<SetStateAction<EditableRow[]>>, index: number, nextRow: EditableRow) { setRows((previous) => previous.map((row, rowIndex) => { if (rowIndex !== index) return row; const id = row[row.length - 1]; return [...nextRow.filter((value) => !isRecordId(value)), ...(isRecordId(id) ? [id] : [])]; })); }

function statusTone(value: string): StatusTone {
  const normalized = value.toLowerCase();
  // Checked before "paid": "Unpaid" and "Part-paid" contain that word but are still outstanding.
  if (normalized.includes("unpaid") || normalized.includes("part")) return "pending";
  // Checked before "active": "Inactive" contains that word. These are all closed / negative states.
  if (/inactive|declin|lost|cancel|fail|refund|void/.test(normalized)) return "expired";
  if (normalized.includes("paid")) return "paid";
  if (normalized.includes("complete")) return "completed";
  if (normalized.includes("accept")) return "accepted";
  if (normalized.includes("overdue") || normalized.includes("out of stock") || normalized.includes("expense")) return "overdue";
  if (normalized.includes("expired")) return "expired";
  if (normalized.includes("pending") || normalized.includes("low stock") || normalized.includes("nurturing") || normalized.includes("hold")) return "pending";
  if (normalized.includes("won")) return "accepted";
  if (normalized.includes("qualified") || normalized.includes("negotiation")) return "proposal";
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

function BulkActions({ selectedCount, options, onEdit, onDelete, onClear, bulkLabel = "Bulk status" }: { selectedCount: number; options: string[]; onEdit: (value: string) => void; onDelete: () => void; onClear: () => void; bulkLabel?: string }) {
  const [value, setValue] = useState("");
  const [importing, setImporting] = useState(false);
  useEffect(() => { if (value && !options.includes(value)) setValue(""); }, [options, value]);
  const exportSelected = (event: React.MouseEvent<HTMLButtonElement>) => { const page = event.currentTarget.closest(".page-content"); const table = page?.querySelector<HTMLTableElement>(".data-table"); if (!table) return; const headers = Array.from(table.querySelectorAll("thead th")).slice(1, -1).map((cell) => cell.textContent?.trim() || ""); const rows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => row.querySelector<HTMLInputElement>(".table-checkbox")?.checked).map((row) => Array.from(row.querySelectorAll("td")).slice(1, -1).map((cell) => cell.textContent?.trim() || "")); const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"); const blob = new Blob([csv], { type: "text/csv;charset=utf-8" }); const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${page?.querySelector("h1")?.textContent?.toLowerCase().replace(/\s+/g, "-") || "records"}-selected.csv`; anchor.click(); URL.revokeObjectURL(url); toast.success(`${rows.length} selected rows exported`); };
  const importCsv = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; const page = event.currentTarget.closest(".page-content"); if (!file || !page) return; const reader = new FileReader(); reader.onload = () => { const rows = parseCsv(String(reader.result || "")); window.dispatchEvent(new CustomEvent("4s-csv-import", { detail: { page: page.querySelector("h1")?.textContent || "", rows } })); toast.success(`${rows.length} CSV rows imported`); setImporting(false); }; reader.readAsText(file); };
  if (!selectedCount) return <div className="csv-utility"><label className="bulk-import"><input type="file" accept=".csv,text/csv" onChange={importCsv} onClick={() => setImporting(true)} /><FileText />{importing ? "Choose CSV" : "Import CSV"}</label><span>Import rows into this table from a matching CSV header.</span></div>;
  return <div className="bulk-actions"><div><strong>{selectedCount} selected</strong><button onClick={onClear}>Clear</button></div>{options.length ? <><label><span>{bulkLabel}</span><select value={value} onChange={(event) => setValue(event.target.value)}><option value="">Choose…</option>{options.map((option) => <option key={option}>{option}</option>)}</select></label><button className="bulk-apply" disabled={!value} onClick={() => { onEdit(value); setValue(""); }}><Check />Apply</button></> : null}<button className="bulk-export" onClick={exportSelected}><FileDown />Export CSV</button><label className="bulk-import"><input type="file" accept=".csv,text/csv" onChange={importCsv} onClick={() => setImporting(true)} /><FileText />{importing ? "Choose CSV" : "Import CSV"}</label><button className="bulk-delete" onClick={onDelete}><Trash2 />Delete selected</button></div>;
}

function EditRecordButton({ onClick }: { onClick: () => void }) { return <button className="record-edit" aria-label="Edit record" onClick={(event) => { event.stopPropagation(); onClick(); }}><Pencil />Edit</button>; }

function RecordActions({ onEdit, onDelete, row, extra }: { onEdit: () => void; onDelete: () => void; row?: EditableRow; extra?: React.ReactNode }) { const { user } = useAuth(); const openHistory = (event: React.MouseEvent<HTMLButtonElement>) => { event.stopPropagation(); const tableRow = event.currentTarget.closest("tr"); const cells = tableRow?.querySelectorAll("td"); const page = event.currentTarget.closest(".page-content")?.querySelector("h1")?.textContent; const label = (page === "Accounting" ? cells?.[2] : cells?.[1])?.textContent?.trim() || tableRow?.textContent?.trim() || "Record"; window.dispatchEvent(new CustomEvent("4s-record-history", { detail: { label, recordId: row ? getRecordId(row) : "" } })); }; return <div className="record-actions">{extra}<EditRecordButton onClick={onEdit} />{user?.role === "admin" ? <button className="record-history" aria-label="View record activity" onClick={openHistory}><History />History</button> : null}<button className="record-delete" aria-label="Delete record" onClick={(event) => { event.stopPropagation(); onDelete(); }}><Trash2 />Delete</button></div>; }

function ActivityHistoryDialog({ target, events, onClose }: { target: { label: string; recordId: string } | null; events: ActivityEvent[]; onClose: () => void }) {
  const { user } = useAuth();
  // The shared audit trail for this record (every user's changes), merged with this browser's own events.
  const shared = trpc.activity.list.useQuery({ recordId: target?.recordId || undefined }, { enabled: Boolean(target?.recordId) && user?.role === "admin" });
  if (!target) return null;
  const { label } = target;
  const local = events.filter((event) => event.label === label || (target.recordId && event.recordId === target.recordId));
  const seen = new Set(local.map((event) => event.id));
  const history = local.concat((shared.data || []).filter((event) => !seen.has(event.id)).map((event) => ({ id: event.id, recordId: event.recordId, label, table: event.tableName, action: event.action, detail: `${event.detail}${event.actorName ? ` · ${event.actorName}` : ""}`, at: new Date(event.createdAt).getTime(), synced: true }))).sort((a, b) => b.at - a.at); const download = () => { const csv = [["Record", "Action", "Detail", "Timestamp"], ...history.map((event) => [label, event.action, event.detail, new Date(event.at).toISOString()])].map((row) => row.map(csvCell).join(",")).join("\n"); const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${label.toLowerCase().replace(/\s+/g, "-")}-activity.csv`; anchor.click(); URL.revokeObjectURL(url); }; return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}><section className="record-dialog panel activity-dialog" role="dialog" aria-modal="true" aria-labelledby="activity-history-title" onMouseDown={(event) => event.stopPropagation()}><div className="record-dialog-head"><div><span className="eyebrow">Per-record audit trail</span><h2 id="activity-history-title">{label}</h2></div><div className="activity-actions"><button onClick={download} className="record-history"><FileDown />Download CSV</button><button className="record-close" aria-label="Close history" onClick={onClose}><X /></button></div></div><div className="activity-timeline">{history.length ? history.map((event) => <div className="activity-event" key={event.id}><i /><div><strong>{event.action}</strong><p>{event.detail}</p><span>{new Date(event.at).toLocaleString()}</span></div></div>) : <p className="activity-empty">No recorded changes yet. New edits, deletions, restores, bulk changes, and imports are captured here.</p>}</div></section></div>; }

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
  return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}><section className="record-dialog panel" role="dialog" aria-modal="true" aria-labelledby="record-editor-title" onMouseDown={(event) => event.stopPropagation()}><div className="record-dialog-head"><div><span className="eyebrow">Workspace record</span><h2 id="record-editor-title">{creating ? `Create ${recordName}` : `Edit ${recordName}`}</h2></div><button className="record-close" aria-label="Close editor" onClick={onClose}><X /></button></div><div className="record-fields">{editor.labels.map((label, index) => { const choice = editor.options?.[index]; const readOnly = editor.readOnly?.includes(index); const update = (next: string) => setDraft((current) => current.map((cell, cellIndex) => cellIndex === index ? next : cell)); return <label key={label}>{label}{choice?.strict && !readOnly ? <select value={draft[index] ?? ""} onChange={(event) => update(event.target.value)}>{(choice.values.includes(draft[index] ?? "") ? choice.values : [draft[index] ?? "", ...choice.values]).map((option) => <option key={option} value={option}>{option || "Choose…"}</option>)}</select> : <><input value={draft[index] ?? ""} readOnly={readOnly} title={readOnly ? "Calculated automatically" : undefined} list={choice ? `record-field-${index}` : undefined} onChange={(event) => update(event.target.value)} />{choice ? <datalist id={`record-field-${index}`}>{choice.values.map((option) => <option key={option} value={option} />)}</datalist> : null}</>}</label>; })}</div><div className="record-dialog-actions"><button className="record-reset" onClick={onClose}>Cancel</button><button className="record-save" disabled={!draft[0]?.trim()} title={!draft[0]?.trim() ? `${editor.labels[0]} is required` : undefined} onClick={() => { editor.onSave(draft); toast.success(`${recordName[0].toUpperCase()}${recordName.slice(1)} ${creating ? "created" : "saved"}`); onClose(); }}><Check />{creating ? "Create record" : "Save changes"}</button></div><p>Changes are saved to your workspace database.</p></section></div>;
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

function Sidebar({ active, onNavigate, onQuickCreate }: { active: PageKey; onNavigate: (p: PageKey) => void; onQuickCreate: () => void }) {
  return <aside className="sidebar"><div className="brand brand-provided"><img src={logo} alt="45Creatives Agency" /></div><nav className="side-nav" aria-label="Primary navigation">{navItems.map(({ label, icon: Icon }) => <button key={label} className={active === label || (active === "Client Details" && label === "Clients") ? "active" : ""} onClick={() => onNavigate(label)}><Icon />{label}</button>)}</nav><div className="sidebar-footer"><button aria-label="Add a new client" title="Add a new client" onClick={onQuickCreate}>+</button></div></aside>;
}

type WorkspaceAlert = { id: string; tone: "danger" | "warning" | "info"; title: string; detail: string; page: PageKey };

/** Things that need attention, worked out from the workspace records. */
type AlertRenewal = { id: string; name: string; clientName: string; amount: number; nextDueDate: Date | string; status: string };
function buildWorkspaceAlerts({ invoiceRows, leadRows, projectRows, quoteRows, inventoryRows, renewals = [] }: { invoiceRows: EditableRow[]; leadRows: EditableRow[]; projectRows: EditableRow[]; quoteRows: EditableRow[]; inventoryRows: EditableRow[]; renewals?: AlertRenewal[] }): WorkspaceAlert[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const inDays = (days: number) => new Date(startOfToday.getTime() + days * 86_400_000);
  const alerts: WorkspaceAlert[] = [];
  invoiceRows.forEach((row) => {
    const id = getRecordId(row);
    if (row[6] === "overdue") alerts.push({ id: `inv-overdue-${id}`, tone: "danger", title: `${row[0]} is overdue`, detail: `${row[1] || "Client"} · ${row[7] || row[4]} outstanding · due ${row[3]}`, page: "Invoices" });
    else if (row[6] === "pending") { const due = parseRowDate(row[3]); if (due && due >= startOfToday && due <= inDays(3)) alerts.push({ id: `inv-due-${id}`, tone: "warning", title: `${row[0]} is due ${due.getTime() === startOfToday.getTime() ? "today" : "soon"}`, detail: `${row[1] || "Client"} · ${row[7] || row[4]} · due ${row[3]}`, page: "Invoices" }); }
  });
  const newLeads = leadRows.filter((row) => (row[4] || "").toLowerCase() === "new");
  if (newLeads.length) alerts.push({ id: "leads-new", tone: "info", title: `${newLeads.length} new lead${newLeads.length === 1 ? "" : "s"} to contact`, detail: newLeads.slice(0, 3).map((row) => row[0]).join(", "), page: "Leads" });
  projectRows.forEach((row) => {
    const label = (row[3] || "").toLowerCase();
    const due = parseRowDate(row[5]);
    if (due && due < startOfToday && !label.includes("complete") && !label.includes("cancel")) alerts.push({ id: `project-late-${getRecordId(row)}`, tone: "danger", title: `${row[0]} is past its due date`, detail: `${row[1] || "No client"} · due ${row[5]} · ${row[2] || 0}% complete`, page: "Projects" });
  });
  quoteRows.forEach((row) => {
    const label = (row[4] || "").toLowerCase();
    const validUntil = parseRowDate(row[6]);
    if ((label === "sent" || label === "draft") && validUntil && validUntil <= inDays(7)) alerts.push({ id: `quote-expiry-${getRecordId(row)}`, tone: validUntil < startOfToday ? "danger" : "warning", title: `${row[0]} ${validUntil < startOfToday ? "has expired" : "expires soon"}`, detail: `${row[1] || "Client"} · valid until ${row[6]}`, page: "Quotes" });
  });
  renewals.forEach((renewal) => {
    const urgency = renewalUrgency(renewal);
    if (urgency !== "overdue" && urgency !== "due-soon") return;
    const days = daysUntil(renewal.nextDueDate);
    // Only flag the next two weeks here; the Renewals page shows the full 30-day window.
    if (urgency === "due-soon" && days > 14) return;
    alerts.push({ id: `renewal-${renewal.id}`, tone: urgency === "overdue" ? "danger" : "warning", title: `${renewal.name} ${urgency === "overdue" ? "renewal is overdue" : days === 0 ? "renews today" : `renews in ${days} day${days === 1 ? "" : "s"}`}`, detail: `${renewal.clientName}${renewal.amount ? ` · ${formatKsh(renewal.amount)} to invoice` : ""}`, page: "Renewals" });
  });
  const stock = inventoryRows.filter((row) => /low stock|out of stock/i.test(row[6] || ""));
  if (stock.length) alerts.push({ id: "stock", tone: "warning", title: `${stock.length} inventory item${stock.length === 1 ? "" : "s"} low or out of stock`, detail: stock.slice(0, 3).map((row) => row[0]).join(", "), page: "Inventory" });
  const rank = { danger: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.tone] - rank[b.tone]);
}

function NotificationsMenu({ alerts, onNavigate }: { alerts: WorkspaceAlert[]; onNavigate: (page: PageKey) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", escape); };
  }, [open]);
  const urgent = alerts.filter((alert) => alert.tone !== "info").length;
  return <div className="notify-wrap" ref={ref}><button className="round-icon" aria-label={`Notifications (${alerts.length})`} aria-expanded={open} onClick={() => setOpen((value) => !value)}><Bell />{alerts.length ? <span className={`notify-badge ${urgent ? "" : "quiet"}`}>{alerts.length > 9 ? "9+" : alerts.length}</span> : null}</button>{open ? <div className="notify-panel panel" role="dialog" aria-label="Notifications"><div className="panel-head"><h2 className="panel-title">Needs attention</h2><span className="panel-subtle">{alerts.length ? `${alerts.length} item${alerts.length === 1 ? "" : "s"}` : "All clear"}</span></div>{alerts.length ? <div className="notify-list">{alerts.slice(0, 12).map((alert) => <button key={alert.id} className={`notify-item ${alert.tone}`} onClick={() => { setOpen(false); onNavigate(alert.page); }}><i /><span><strong>{alert.title}</strong><small>{alert.detail}</small></span><ChevronRight /></button>)}</div> : <p className="activity-empty">Nothing needs your attention right now. Overdue invoices, invoices due soon, upcoming renewals, new leads, late projects, expiring quotes and stock alerts show up here.</p>}</div> : null}</div>;
}

function Topbar({ query, onQuery, onNavigate, alerts }: { query: string; onQuery: (value: string) => void; onNavigate: (page: PageKey) => void; alerts: WorkspaceAlert[] }) {
  const { user, loading, logout } = useAuth();
  const profile = trpc.auth.profile.useQuery(undefined, { enabled: Boolean(user) });
  const avatar = profile.data?.avatarUrl || profile.data?.providerImageUrl || user?.providerImageUrl || nadia;
  return <div className="topbar"><label className="searchbox"><Search /><input value={query} onChange={(e) => onQuery(e.target.value)} placeholder="Search clients, invoices, projects…" aria-label="Search workspace" />{query ? <button className="search-clear" aria-label="Clear search" onClick={() => onQuery("")}><X /></button> : null}</label><div className="topbar-actions"><NotificationsMenu alerts={alerts} onNavigate={onNavigate} /><button className="round-icon" aria-label="Open 4S Insight assistant" title="Ask 4S Insight" onClick={() => onNavigate("AI Assistant")}><Headphones /></button>{user ? <><button className="profile-chip profile-action" onClick={() => onNavigate("Settings")} aria-label="Open account settings"><img src={avatar} alt="Profile avatar" /><div><strong>{profile.data?.displayName || user.name || "Workspace user"}</strong><span>{user.role === "admin" ? "Administrator" : "Team member"}</span></div></button><button className="round-icon" aria-label="Sign out" title="Sign out" disabled={loading} onClick={() => { if (window.confirm("Sign out of the workspace?")) logout().catch((error) => toast.error(error instanceof Error ? error.message : "Unable to sign out")); }}><LogOut /></button></> : <button className="heading-action" onClick={() => startLogin()} disabled={loading}>Sign in</button>}</div></div>;
}

const searchableTables: { table: string; page: PageKey; label: string; title: (row: EditableRow) => string; meta: (row: EditableRow) => string }[] = [
  { table: "clients", page: "Clients", label: "Clients", title: (r) => r[0], meta: (r) => [r[1], r[2], r[3]].filter(Boolean).join(" · ") },
  { table: "leads", page: "Leads", label: "Leads", title: (r) => r[0], meta: (r) => [r[1], r[4], r[7]].filter(Boolean).join(" · ") },
  { table: "projects", page: "Projects", label: "Projects", title: (r) => r[0], meta: (r) => [r[1], r[3], r[5] && `due ${r[5]}`].filter(Boolean).join(" · ") },
  { table: "quotes", page: "Quotes", label: "Quotes", title: (r) => r[0], meta: (r) => [r[1], r[3], r[4]].filter(Boolean).join(" · ") },
  { table: "invoices", page: "Invoices", label: "Invoices", title: (r) => r[0], meta: (r) => [r[1], r[4], r[5]].filter(Boolean).join(" · ") },
  { table: "payments", page: "Payments", label: "Payments", title: (r) => r[0], meta: (r) => [r[1], r[2], r[4]].filter(Boolean).join(" · ") },
  { table: "inventory", page: "Inventory", label: "Inventory", title: (r) => r[0], meta: (r) => [r[1], r[2], r[6]].filter(Boolean).join(" · ") },
  { table: "transactions", page: "Accounting", label: "Transactions", title: (r) => r[2] || r[1], meta: (r) => [r[0], r[3], r[4]].filter(Boolean).join(" · ") },
];

/** Workspace-wide search results, shown on pages that don't have a table of their own to filter. */
function GlobalSearchResults({ query, tables, onOpen }: { query: string; tables: Record<string, EditableRow[]>; onOpen: (page: PageKey, row: EditableRow, table: string) => void }) {
  const needle = query.trim().toLowerCase();
  const groups = searchableTables.map((source) => ({ source, rows: (tables[source.table] || []).filter((row) => row.filter((cell) => !isRecordId(cell)).join(" ").toLowerCase().includes(needle)) })).filter((group) => group.rows.length);
  return <section className="panel search-results" aria-label="Search results"><div className="panel-head"><h2 className="panel-title">Search results for “{query.trim()}”</h2><span className="panel-subtle">{groups.reduce((sum, group) => sum + group.rows.length, 0)} matches</span></div>{groups.length ? <div className="search-groups">{groups.map(({ source, rows }) => <div key={source.table} className="search-group"><h3>{source.label} <small>{rows.length}</small></h3>{rows.slice(0, 5).map((row) => <button key={getRecordId(row) || source.title(row)} onClick={() => onOpen(source.page, row, source.table)}><strong>{source.title(row)}</strong><span>{source.meta(row)}</span></button>)}{rows.length > 5 ? <button className="text-button" onClick={() => onOpen(source.page, rows[0], "")}>View all {rows.length} in {source.label}</button> : null}</div>)}</div> : <p className="activity-empty">No records match your search.</p>}</section>;
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
  const [revenuePeriod, setRevenuePeriod] = useState("Last 12 months");
  const [cashPeriod, setCashPeriod] = useState("This Month");

  const now = new Date();
  const isThisMonth = (row: EditableRow) => { const date = parseRowDate(row[0]); return date ? date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() : false; };
  // Revenue is money actually received: income in the ledger (recorded payments post there automatically).
  const totalRevenue = transactionRows.filter((row) => row[5] === "positive").reduce((sum, row) => sum + parseAmount(row[4]), 0);
  // Invoice rows carry the server-worked status tone (row[6]) and the remaining balance (row[7]).
  const outstandingInvoices = invoiceRows.filter((row) => row[6] === "pending" || row[6] === "overdue");
  const outstandingTotal = outstandingInvoices.reduce((sum, row) => sum + parseAmount(row[7] ?? row[4]), 0);
  const mtdIncome = transactionRows.filter((row) => row[5] === "positive" && isThisMonth(row)).reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const mtdExpense = transactionRows.filter((row) => row[5] === "negative" && isThisMonth(row)).reduce((sum, row) => sum + parseAmount(row[4]), 0);

  // A single month would plot as one invisible point, so the shortest range is a quarter.
  const periodMonths = revenuePeriod === "Last 12 months" ? 12 : revenuePeriod === "Last 6 months" ? 6 : 3;
  const revenueSeries = useMemo(() => monthlySeriesFromTransactions(transactionRows, periodMonths), [transactionRows, periodMonths]);

  const cashCutoff = cashPeriod === "This Month" ? new Date(now.getFullYear(), now.getMonth(), 1) : cashPeriod === "This Quarter" ? new Date(now.getFullYear(), now.getMonth() - (now.getMonth() % 3), 1) : new Date(now.getFullYear(), 0, 1);
  const cashInflow = transactionRows.filter((row) => row[5] === "positive" && (parseRowDate(row[0]) || cashCutoff) >= cashCutoff).reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const cashOutflow = transactionRows.filter((row) => row[5] === "negative" && (parseRowDate(row[0]) || cashCutoff) >= cashCutoff).reduce((sum, row) => sum + parseAmount(row[4]), 0);

  const newestFirst = (index: number) => (a: EditableRow, b: EditableRow) => (parseRowDate(b[index])?.getTime() || 0) - (parseRowDate(a[index])?.getTime() || 0);
  const recentInvoices = invoiceRows.filter((row) => row[6] !== "void").sort(newestFirst(2)).slice(0, 4);
  const recentExpenses = transactionRows.filter((row) => row[5] === "negative").sort(newestFirst(0)).slice(0, 4);

  return <div className="page-content"><PageHeader title={`Welcome back, ${name}`} subtitle={`${role} · Here’s what’s happening with 45Creatives today.`} />
    <section className="dashboard-profile-row"><DashboardProfileCard /><DashboardQuickStats onNavigate={onNavigate} invoiceRows={invoiceRows} projectRows={projectRows} inventoryRows={inventoryRows} transactionRows={transactionRows} /></section>
    <section className="metric-grid"><MetricCard label="Total Revenue" value={formatKsh(totalRevenue)} meta="All income received" /><MetricCard label="Outstanding Invoices" value={formatKsh(outstandingTotal)} meta={`${outstandingInvoices.length} invoice${outstandingInvoices.length === 1 ? "" : "s"}`} /><MetricCard label="Total Clients" value={String(clientRows.length)} /><MetricCard label="Profit (MTD)" value={formatKsh(mtdIncome - mtdExpense)} /></section>
    <section className="dashboard-split"><div className="panel"><div className="panel-head"><h2 className="panel-title">Revenue Overview</h2><select className="panel-subtle period-select" value={revenuePeriod} onChange={(event) => setRevenuePeriod(event.target.value)} aria-label="Revenue period">{["Last 12 months", "Last 6 months", "Last 3 months"].map((option) => <option key={option}>{option}</option>)}</select></div><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><AreaChart data={revenueSeries} margin={{ top: 8, right: 5, left: -19, bottom: 0 }}><defs><linearGradient id="revFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#c74d50" stopOpacity={.38} /><stop offset="1" stopColor="#c74d50" stopOpacity={0} /></linearGradient></defs><CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} strokeDasharray="3 3" /><XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fill: "#7e858a", fontSize: 9 }} dy={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#7e858a", fontSize: 8 }} tickFormatter={(v) => `${v}K`} /><Tooltip contentStyle={{ background: "#15171a", border: "1px solid rgba(255,255,255,.1)", borderRadius: 7, fontSize: 10 }} labelStyle={{ color: "#b7babc" }} itemStyle={{ color: "#e86d6e" }} formatter={(value) => [formatKsh((value as number) * 1000), "Revenue"]} /><Area type="monotone" dataKey="revenue" stroke="#d85a5d" strokeWidth={2} fill="url(#revFill)" activeDot={{ r: 4, fill: "#f8e5e4", stroke: "#d85a5d", strokeWidth: 3 }} /></AreaChart></ResponsiveContainer></div></div>
      <div className="panel"><div className="panel-head"><h2 className="panel-title">Cash Flow</h2><select className="panel-subtle period-select" value={cashPeriod} onChange={(event) => setCashPeriod(event.target.value)} aria-label="Cash flow period">{["This Month", "This Quarter", "This Year"].map((option) => <option key={option}>{option}</option>)}</select></div><div className="cash-list"><div className="cash-item"><span>Inflow <small>↗</small></span><strong>{formatKsh(cashInflow)}</strong></div><div className="cash-item out"><span>Outflow <small>↘</small></span><strong>{formatKsh(cashOutflow)}</strong></div><div className="cash-item net"><span>Net Flow</span><strong>{formatKsh(cashInflow - cashOutflow)}</strong></div></div></div></section>
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
  const owed = rows.reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const pct = (count: number) => rows.length ? `${Math.round((count / rows.length) * 100)}% of total` : "";
  return <div className="page-content"><PageHeader title="Clients" subtitle="Manage your clients and organizations" action="Add Client" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Total Clients" value={String(rows.length)} meta={owed > 0 ? `${formatKsh(owed)} outstanding` : undefined} /><MetricCard label="Active Clients" value={String(active)} meta={pct(active)} /><MetricCard label="Pending Clients" value={String(pending)} meta={pct(pending)} /><MetricCard label="Inactive Clients" value={String(inactive)} meta={pct(inactive)} /></section><TableDiscovery placeholder="Search clients…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.filteredCount} client record${discovery.filteredCount === 1 ? "" : "s"}`} /><BulkActions selectedCount={selection.selected.size} options={clientStatusOptions} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible clients" /></th><th>Client Name</th><th>Primary Contact</th><th>Email</th><th>Phone</th><th>Outstanding</th><th>Status</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No clients yet. Add your first client to get started.</td></tr> : discovery.visibleRows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No clients match your search.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={getRecordId(r) || index} className="clickable" onClick={() => onView(index)}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1] || "-"}</td><td>{r[2] || "-"}</td><td>{r[3] || "-"}</td><td className="value-cell">{r[4]}</td><td><Status label={r[5]} tone={statusTone(r[5])} /></td><td><RecordActions row={r} onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>;
}

function LeadsPage({ query, rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete, onConvert }: { query: string; rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void; onConvert: (index: number) => void }) {
  const discovery = useTableDiscovery(rows, 4, query);
  const selection = useBulkSelection();
  const visibleIndices = discovery.visibleRows.map(({ index }) => index);
  const stage = (row: EditableRow) => (row[4] || "").trim().toLowerCase();
  const open = rows.filter((row) => stage(row) !== "won" && stage(row) !== "lost");
  const newCount = rows.filter((row) => stage(row) === "new").length;
  const inProgress = rows.filter((row) => ["contacted", "qualified", "proposal", "negotiation", "nurturing"].includes(stage(row))).length;
  const won = rows.filter((row) => stage(row) === "won").length;
  const decided = won + rows.filter((row) => stage(row) === "lost").length;
  const pipeline = open.reduce((sum, row) => sum + parseAmount(row[3]), 0);
  return <div className="page-content"><PageHeader title="Leads" subtitle="Track enquiries from first contact to signed client" action="Add Lead" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Open Pipeline" value={formatKsh(pipeline)} meta={`${open.length} open lead${open.length === 1 ? "" : "s"}`} /><MetricCard label="New Leads" value={String(newCount)} meta={newCount ? "Waiting for first contact" : undefined} /><MetricCard label="In Progress" value={String(inProgress)} /><MetricCard label="Won" value={String(won)} meta={decided ? `${Math.round((won / decided) * 100)}% win rate` : undefined} tone={won ? "success" : undefined} /></section><TableDiscovery placeholder="Search leads…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.filteredCount} lead${discovery.filteredCount === 1 ? "" : "s"} found`} /><BulkActions selectedCount={selection.selected.size} options={leadStatusOptions} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible leads" /></th><th>Lead Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Source</th><th>Value</th><th>Status</th><th>Assigned To</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={10} className="activity-empty">No leads yet. Add one, or connect your website form under Settings → Integrations.</td></tr> : discovery.visibleRows.length === 0 ? <tr><td colSpan={10} className="activity-empty">No leads match your search.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={getRecordId(r) || index}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1] || "-"}</td><td>{r[7] ? <a className="cell-link" href={`mailto:${r[7]}`}>{r[7]}</a> : "-"}</td><td>{r[8] ? <a className="cell-link" href={`tel:${r[8].replace(/\s+/g, "")}`}>{r[8]}</a> : "-"}</td><td>{r[2] || "-"}</td><td className="value-cell">{r[3]}</td><td><Status label={r[4]} tone={statusTone(r[4])} /></td><td>{r[6] || "Unassigned"}</td><td><RecordActions row={r} onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} extra={stage(r) !== "won" ? <button className="record-edit" aria-label={`Convert ${r[0]} to a client`} title="Create a client from this lead and mark it Won" onClick={(event) => { event.stopPropagation(); onConvert(index); }}><UserRound />Convert</button> : null} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>;
}

function ProjectsPage({ query, rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete, onOpen }: { onOpen: (index: number) => void; query: string; rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) {
  const discovery = useTableDiscovery(rows, 3, query);
  const selection = useBulkSelection();
  const visibleIndices = discovery.visibleRows.map(({ index }) => index);
  const stage = (row: EditableRow) => (row[3] || "").toLowerCase();
  const isClosed = (row: EditableRow) => stage(row).includes("complete") || stage(row).includes("cancel");
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const isLate = (row: EditableRow) => { const due = parseRowDate(row[5]); return Boolean(due && due < startOfToday && !isClosed(row)); };
  const completed = rows.filter((row) => stage(row).includes("complete")).length;
  const active = rows.filter((row) => !isClosed(row));
  const late = rows.filter(isLate).length;
  const activeValue = active.reduce((sum, row) => sum + parseAmount(row[6]), 0);
  return <div className="page-content"><PageHeader title="Projects" subtitle="Track delivery for every client build" action="New Project" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Total Projects" value={String(rows.length)} /><MetricCard label="Active" value={String(active.length)} meta={activeValue ? `${formatKsh(activeValue)} in progress` : undefined} /><MetricCard label="Past Due" value={String(late)} meta={late ? "Past their due date" : "Everything on schedule"} tone={late ? "danger" : undefined} /><MetricCard label="Completed" value={String(completed)} tone={completed ? "success" : undefined} /></section><TableDiscovery placeholder="Search projects…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.filteredCount} project${discovery.filteredCount === 1 ? "" : "s"} found`} /><BulkActions selectedCount={selection.selected.size} options={projectStatusOptions} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table projects-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible projects" /></th><th>Project Name</th><th>Client</th><th>Progress</th><th>Status</th><th>Due Date</th><th>Value</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No projects yet. Create your first project to get started.</td></tr> : discovery.visibleRows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No projects match your search.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={getRecordId(r) || index}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1] || "-"}</td><td><div className="progress-cell"><div className="progress-line"><span style={{ width: `${Math.min(100, Math.max(0, Number(r[2]) || 0))}%` }} /></div><small>{Number(r[2]) || 0}%</small></div></td><td><Status label={r[3]} tone={statusTone(r[3])} /></td><td className={isLate(r) ? "danger" : undefined} title={isLate(r) ? "Past due" : undefined}>{r[5] || "-"}</td><td className="value-cell">{r[6]}</td><td><RecordActions row={r} onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} extra={<button className="record-edit" title="Milestones, tasks, change requests and time" aria-label={`Open workspace for ${r[0]}`} onClick={(event) => { event.stopPropagation(); onOpen(index); }}><FolderKanban />Work</button>} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>;
}

function QuotesPage({ query, rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete, onInvoice }: { query: string; rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void; onInvoice: (index: number) => void }) {
  const discovery = useTableDiscovery(rows, 4, query);
  const selection = useBulkSelection();
  const visibleIndices = discovery.visibleRows.map(({ index }) => index);
  const stage = (row: EditableRow) => (row[4] || "").trim().toLowerCase();
  const sum = (list: EditableRow[]) => list.reduce((total, row) => total + parseAmount(row[3]), 0);
  const draft = rows.filter((row) => stage(row) === "draft");
  const sent = rows.filter((row) => stage(row) === "sent");
  const accepted = rows.filter((row) => stage(row) === "accepted");
  const decided = accepted.length + rows.filter((row) => stage(row) === "declined" || stage(row) === "expired").length;
  return <div className="page-content"><PageHeader title="Quotes" subtitle="Create quotations and turn accepted ones into invoices" action="New Quote" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Total Quotes" value={String(rows.length)} meta={rows.length ? `${formatKsh(sum(rows))} quoted` : undefined} /><MetricCard label="Draft" value={String(draft.length)} /><MetricCard label="Sent" value={String(sent.length)} meta={sent.length ? `${formatKsh(sum(sent))} awaiting a decision` : undefined} /><MetricCard label="Accepted" value={String(accepted.length)} meta={decided ? `${Math.round((accepted.length / decided) * 100)}% acceptance rate` : undefined} tone={accepted.length ? "success" : undefined} /></section><TableDiscovery placeholder="Search quotes…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.filteredCount} quote${discovery.filteredCount === 1 ? "" : "s"} found`} /><BulkActions selectedCount={selection.selected.size} options={quoteStatusOptions} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible quotes" /></th><th>Quote #</th><th>Client</th><th>Project</th><th>Value</th><th>Status</th><th>Valid Until</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No quotes yet. Create your first quote to get started.</td></tr> : discovery.visibleRows.length === 0 ? <tr><td colSpan={8} className="activity-empty">No quotes match your search.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={getRecordId(r) || index}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1] || "-"}</td><td>{r[2] || "-"}</td><td className="value-cell">{r[3]}</td><td><Status label={r[4]} tone={statusTone(r[4])} /></td><td>{r[6] || "-"}</td><td><RecordActions row={r} onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} extra={<button className="record-edit" title="Line items, PDF, sending, client acceptance and converting to an invoice" aria-label={`Open quotation ${r[0]}`} onClick={(event) => { event.stopPropagation(); onInvoice(index); }}><FileText />Open</button>} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>;
}

type InvoiceSummaryRow = { id: string; number: string; clientName: string; issueDate: Date; dueDate: Date | null; total: number; received: number; balance: number; status: string; hasDocument: boolean; sentAt: Date | null; lastSentChannel: string | null; currency?: string; balanceKes?: number };

/** Invoices work like agreements in Contracts: a server-backed list, a "New Invoice" form, and a
 * popup per invoice to edit, send by email / WhatsApp, download, record payments, void or delete. */
function InvoicesPage({ query, onCreate, onView, onDelete }: { query: string; onCreate: () => void; onView: (id: string) => void; onDelete: (id: string, number: string) => void }) {
  const { user } = useAuth();
  const list = trpc.invoiceDocs.summaries.useQuery(undefined, { enabled: Boolean(user) });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const invoices = (list.data || []) as InvoiceSummaryRow[];
  const awaiting = invoices.filter((i) => i.status === "UNPAID" || i.status === "PART-PAID" || i.status === "OVERDUE");
  const counts = { total: invoices.length, draft: invoices.filter((i) => i.status === "DRAFT").length, awaiting: awaiting.length, paid: invoices.filter((i) => i.status === "PAID").length };
  const outstanding = awaiting.reduce((sum, i) => sum + (i.balanceKes ?? i.balance), 0);
  const matches = (i: InvoiceSummaryRow, text: string) => !text.trim() || `${i.number} ${i.clientName} ${i.status}`.toLowerCase().includes(text.trim().toLowerCase());
  const visible = invoices.filter((i) => (statusFilter === "All" || i.status === statusFilter) && matches(i, search) && matches(i, query));
  const day = (value: Date | null) => value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "-";
  return <div className="page-content">
    <PageHeader title="Invoices" subtitle="Create, send and track 45Creatives invoices" action="New Invoice" onAction={onCreate} />
    <section className="metric-grid">
      <MetricCard label="Total Invoices" value={String(counts.total)} />
      <MetricCard label="Draft" value={String(counts.draft)} />
      <MetricCard label="Awaiting Payment" value={String(counts.awaiting)} meta={outstanding > 0 ? `${formatKsh(outstanding)} outstanding` : undefined} tone={invoices.some((i) => i.status === "OVERDUE") ? "danger" : undefined} />
      <MetricCard label="Paid" value={String(counts.paid)} tone="success" />
    </section>
    <div className="filterbar table-discovery"><label className="searchbox"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice number or client…" aria-label="Search invoices" /></label><label className="table-filter"><SlidersHorizontal /><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filter invoices by status">{["All", "DRAFT", "UNPAID", "PART-PAID", "OVERDUE", "PAID", "VOID"].map((option) => <option key={option} value={option}>{option === "All" ? "All statuses" : option}</option>)}</select></label></div>
    <div className="panel table-panel"><div className="table-scroller"><table className="data-table">
      <thead><tr><th>Invoice #</th><th>Client</th><th>Issued</th><th>Due</th><th>Total</th><th>Balance</th><th>Status</th><th></th></tr></thead>
      <tbody>{list.isLoading ? <tr><td colSpan={8} className="activity-empty">Loading invoices…</td></tr> : visible.length === 0 ? <tr><td colSpan={8} className="activity-empty">{invoices.length ? "No invoices match your search." : "No invoices yet. Create one to get started."}</td></tr> : visible.map((i) => <tr key={i.id} className="clickable" onClick={() => onView(i.id)}>
        <td className="strong-cell">{i.number}{i.sentAt ? <span className="sent-chip" title={`Sent by ${i.lastSentChannel === "whatsapp" ? "WhatsApp" : "email"}`}>Sent · {i.lastSentChannel === "whatsapp" ? "WhatsApp" : "Email"}</span> : null}</td>
        <td>{i.clientName || "-"}</td>
        <td>{day(i.issueDate)}</td>
        <td>{day(i.dueDate)}</td>
        <td className="value-cell">{formatInvoiceMoney(i.total, i.currency || "KES").replace(/\.00$/, "")}</td>
        <td className="value-cell">{formatInvoiceMoney(i.balance, i.currency || "KES").replace(/\.00$/, "")}</td>
        <td><Status label={i.status} tone={invoiceStatusTone(i.status)} /></td>
        <td onClick={(event) => event.stopPropagation()}><div className="record-actions"><button className="record-edit" onClick={() => onView(i.id)}><FileText />View</button><button className="record-edit contract-delete-button" onClick={() => onDelete(i.id, i.number)}><Trash2 />Delete</button></div></td>
      </tr>)}</tbody>
    </table></div></div>
  </div>;
}

function PaymentsPage({ query, rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete, panel }: { panel?: React.ReactNode; query: string; rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) {
  const discovery = useTableDiscovery(rows, 6, query); const selection = useBulkSelection(); const visibleIndices = discovery.visibleRows.map(({ index }) => index);
  const now = new Date();
  const sum = (list: EditableRow[]) => list.reduce((total, row) => total + parseAmount(row[4]), 0);
  const completedRows = rows.filter((row) => statusTone(row[6]) === "completed");
  const thisMonth = completedRows.filter((row) => { const date = parseRowDate(row[3]); return date ? date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() : false; });
  const pendingRows = rows.filter((row) => statusTone(row[6]) === "pending");
  const failedRows = rows.filter((row) => statusTone(row[6]) === "expired");
  return <div className="page-content"><PageHeader title="Payments" subtitle="Payments received against invoices. Completed payments post to Accounting automatically." action="Record Payment" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Total Received" value={formatKsh(sum(completedRows))} meta={`${completedRows.length} completed payment${completedRows.length === 1 ? "" : "s"}`} /><MetricCard label="This Month" value={formatKsh(sum(thisMonth))} /><MetricCard label="Pending" value={formatKsh(sum(pendingRows))} meta={`${pendingRows.length} payment${pendingRows.length === 1 ? "" : "s"} to confirm`} tone={pendingRows.length > 0 ? "danger" : undefined} /><MetricCard label="Failed / Refunded" value={formatKsh(sum(failedRows))} meta={`${failedRows.length} payment${failedRows.length === 1 ? "" : "s"}`} tone={failedRows.length > 0 ? "danger" : undefined} /></section>{panel}<TableDiscovery placeholder="Search payments…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.filteredCount} payment${discovery.filteredCount === 1 ? "" : "s"} found`} /><BulkActions selectedCount={selection.selected.size} options={paymentStatusOptions} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible payments" /></th><th>Payment #</th><th>Client</th><th>Invoice</th><th>Date</th><th>Amount</th><th>Method</th><th>Status</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={9} className="activity-empty">No payments recorded yet. Record one here, or from an invoice with “Record payment”.</td></tr> : discovery.visibleRows.length === 0 ? <tr><td colSpan={9} className="activity-empty">No payments match your search.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={getRecordId(r) || index}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1] || "-"}</td><td>{r[2] || <span className="panel-subtle" title="Not linked to an invoice">Not linked</span>}</td><td>{r[3]}</td><td className="value-cell">{r[4]}</td><td>{r[5] || "-"}</td><td><Status label={r[6]} tone={statusTone(r[6])} /></td><td><RecordActions row={r} onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>; }

function ClientDetails({ client, projectRows, invoiceRows, paymentRows, onBack, onEdit, onNewInvoice, onOpenInvoice, vault }: { vault?: React.ReactNode; client: EditableRow | null; projectRows: EditableRow[]; invoiceRows: EditableRow[]; paymentRows: EditableRow[]; onBack: () => void; onEdit: () => void; onNewInvoice: () => void; onOpenInvoice: (id: string) => void }) {
  if (!client) return <div className="page-content"><PageHeader title="Client Details" subtitle="Clients" /><div className="filterbar"><button className="text-button" onClick={onBack}><ArrowLeft size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Back to clients</button></div><p className="activity-empty">This client is no longer available. Select a client from the Clients table to view their details.</p></div>;
  const [name, contact, email, phone, , statusLabel] = client;
  const same = (value: string | undefined) => (value || "").trim().toLowerCase() === (name || "").trim().toLowerCase();
  const initials = (name || "?").split(/\s+/).map((word) => word[0]).slice(0, 2).join("").toUpperCase();
  const relatedProjects = projectRows.filter((row) => same(row[1]));
  const relatedInvoices = invoiceRows.filter((row) => same(row[1]) && row[6] !== "void").sort((a, b) => (parseRowDate(b[2])?.getTime() || 0) - (parseRowDate(a[2])?.getTime() || 0));
  const relatedPayments = paymentRows.filter((row) => same(row[1]));
  const billed = relatedInvoices.filter((row) => row[6] !== "draft");
  const balance = (row: EditableRow) => parseAmount(row[7] ?? (row[6] === "paid" ? "0" : row[4]));
  const invoicedTotal = billed.reduce((sum, row) => sum + parseAmount(row[4]), 0);
  const outstandingAmount = billed.filter((row) => row[6] === "pending" || row[6] === "overdue").reduce((sum, row) => sum + balance(row), 0);
  const overdueAmount = billed.filter((row) => row[6] === "overdue").reduce((sum, row) => sum + balance(row), 0);
  const totalPaid = Math.max(0, invoicedTotal - outstandingAmount);
  const pieData = invoicedTotal > 0 ? [
    { name: "Paid", value: Math.round((totalPaid / invoicedTotal) * 100), color: "#db6265" },
    { name: "Outstanding", value: Math.round(((outstandingAmount - overdueAmount) / invoicedTotal) * 100), color: "#d8d4cc" },
    { name: "Overdue", value: Math.round((overdueAmount / invoicedTotal) * 100), color: "#8b383a" },
  ].filter((slice) => slice.value > 0) : [];
  const whatsapp = (phone || "").replace(/[^\d]/g, "").replace(/^0/, "254");
  return <div className="page-content"><PageHeader title="Client Details" subtitle={`Clients  ›  ${name}`} /><div className="filterbar client-detail-actions"><button className="text-button" onClick={onBack}><ArrowLeft size={12} style={{ verticalAlign: -2, marginRight: 5 }} />Back to clients</button><span /><button className="record-edit" onClick={onEdit}><Pencil />Edit client</button><button className="record-edit" onClick={onNewInvoice}><ReceiptText />New invoice</button>{email ? <a className="record-edit" href={`mailto:${email}`}><Mail />Email</a> : null}{whatsapp ? <a className="record-edit" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer"><MessageCircle />WhatsApp</a> : null}</div><section className="client-detail-grid"><div className="panel client-card"><div className="client-identity"><div className="identity-mark">{initials}</div><div><h2>{name}</h2><p>{statusLabel} client</p></div></div><div className="detail-list"><div><UserRound />{contact || "No contact on file"}</div><div><Mail />{email || "No email on file"}</div><div><Phone />{phone || "No phone on file"}</div></div></div><div className="panel"><div className="detail-stats"><div className="detail-stat"><span>Total Projects</span><strong>{relatedProjects.length}</strong></div><div className="detail-stat"><span>Total Invoices</span><strong>{relatedInvoices.length}</strong></div><div className="detail-stat"><span>Total Paid</span><strong>{formatKsh(totalPaid)}</strong></div><div className="detail-stat"><span>Outstanding</span><strong className="red">{formatKsh(outstandingAmount)}</strong></div></div><div className="detail-body"><div className="small-panel"><h3>Recent Invoices</h3><div className="feed">{relatedInvoices.length ? relatedInvoices.slice(0, 4).map((r) => <button type="button" className="feed-row feed-button" key={getRecordId(r) || r[0]} onClick={() => onOpenInvoice(getRecordId(r))}><i className={`feed-dot ${r[6] === "paid" ? "green" : ""}`} /><span>{r[0]}</span><span>{r[4]}</span><span><Status label={r[5]} tone={r[6] === "void" ? "expired" : r[6]} /></span></button>) : <p className="activity-empty">No invoices for this client yet.</p>}</div></div><div className="small-panel"><h3>Payment Summary</h3>{pieData.length ? <><div className="donut-wrap"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="value" innerRadius={42} outerRadius={62} paddingAngle={4} stroke="none">{pieData.map((p) => <Cell key={p.name} fill={p.color} />)}</Pie></PieChart></ResponsiveContainer></div><div className="donut-legend">{pieData.map((p) => <div className="legend-row" key={p.name}><span><i style={{ background: p.color }} />{p.name}</span><strong>{p.value}%</strong></div>)}</div></> : <p className="activity-empty">No invoiced amounts yet.</p>}</div></div></div></section><section className="bottom-panels" style={{ marginTop: 13 }}><div className="panel"><div className="panel-head"><h2 className="panel-title">Projects</h2></div><div className="feed">{relatedProjects.length ? relatedProjects.slice(0, 5).map((p, index) => <div className="feed-row" key={getRecordId(p) || index}><i className="feed-dot" /><span>{p[0]}</span><span>{Number(p[2]) || 0}%</span><span><Status label={p[3]} tone={statusTone(p[3])} /></span></div>) : <p className="activity-empty">No projects for this client yet.</p>}</div></div><div className="panel"><div className="panel-head"><h2 className="panel-title">Payments</h2></div><div className="feed">{relatedPayments.length ? relatedPayments.slice(0, 5).map((p, index) => <div className="feed-row" key={getRecordId(p) || index}><i className={`feed-dot ${statusTone(p[6]) === "completed" ? "green" : ""}`} /><span>{p[0]}{p[2] ? ` · ${p[2]}` : ""}</span><span>{p[4]}</span><span>{p[3]}</span></div>) : <p className="activity-empty">No payments from this client yet.</p>}</div></div></section>{vault}</div>;
}

function InventoryPage({ query, rows, onEdit, onCreate, onDelete, onBulkDelete }: { query: string; rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkDelete: (indices: number[]) => void }) { const discovery = useTableDiscovery(rows, 6, query); const selection = useBulkSelection(); const visibleIndices = discovery.visibleRows.map(({ index }) => index); const totalValue = rows.reduce((sum, row) => sum + parseAmount(row[5]), 0); const lowStockCount = rows.filter((row) => /low stock|out of stock/i.test(row[6] || "")).length; const categories = new Set(rows.map((row) => row[1]).filter(Boolean)).size; return <div className="page-content"><PageHeader title="Inventory" subtitle="Track equipment, assets, and production supplies" action="Add Item" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Tracked Items" value={String(rows.length)} meta={categories ? `Across ${categories} categor${categories === 1 ? "y" : "ies"}` : undefined} /><MetricCard label="Inventory Value" value={formatKsh(totalValue)} meta="Quantity × unit cost" /><MetricCard label="Low Stock" value={String(lowStockCount)} meta={lowStockCount ? "Needs attention (1 or fewer left)" : "All items well stocked"} tone={lowStockCount ? "danger" : undefined} /></section><TableDiscovery placeholder="Search inventory…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.filteredCount} item${discovery.filteredCount === 1 ? "" : "s"}`} /><BulkActions selectedCount={selection.selected.size} options={[]} onEdit={() => undefined} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="panel table-panel"><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible inventory items" /></th><th>Item</th><th>Category</th><th>SKU</th><th>Qty.</th><th>Unit Cost</th><th>Stock Value</th><th>Status</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={9} className="activity-empty">No inventory items yet. Add your first item to get started.</td></tr> : discovery.visibleRows.length === 0 ? <tr><td colSpan={9} className="activity-empty">No items match your search.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={getRecordId(r) || index}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[0]}`} /></td><td className="strong-cell">{r[0]}</td><td>{r[1]}</td><td>{r[2] || "-"}</td><td>{r[3]}</td><td className="value-cell">{r[4]}</td><td className="value-cell">{r[5]}</td><td><Status label={r[6]} tone={statusTone(r[6])} /></td><td><RecordActions row={r} onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>; }

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
  // Reset only when the dialog opens. The parent builds `initial` fresh on every render, so
  // depending on it wiped everything typed whenever the agreements list refetched (e.g. on
  // returning to the tab) or a save failed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) setForm(initial); }, [open]);
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

function ContractViewDialog({ contract, onClose, onDelete, deleting, onCreateInvoice }: { contract: ContractRecord | null; onClose: () => void; onDelete: (contract: ContractRecord) => void; deleting: boolean; onCreateInvoice: (contract: ContractRecord) => void }) {
  const utils = trpc.useUtils();
  const [signatureName, setSignatureName] = useState("");
  const [providerSignatureImage, setProviderSignatureImage] = useState<string | null>(null);
  const [sending, setSending] = useState<"email" | "whatsapp" | null>(null);
  const composeWindow = useRef<Window | null>(null);
  const resendWindow = useRef<Window | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sendResult, setSendResult] = useState<{ channel: "email" | "whatsapp"; signingUrl: string; waLink: string | null; emailDraftUrl: string; deliveryError: string | null; emailConfigured: boolean; whatsappCloudConfigured: boolean; documensoConfigured: boolean; documensoEnvelopeId: string | null; documensoError: string | null } | null>(null);
  const waMessages = trpc.whatsapp.listByContract.useQuery(
    { contractId: contract?.id || "" },
    { enabled: Boolean(contract?.id) }
  );
  useEffect(() => { setSignatureName(contract?.providerName || ""); setProviderSignatureImage(null); setSendResult(null); }, [contract?.id]);
  const signProvider = trpc.contracts.signProvider.useMutation({ onSuccess: () => { toast.success("Your drawn signature was added to the agreement"); utils.contracts.list.invalidate(); utils.contracts.get.invalidate(); }, onError: (error) => toast.error(error.message) });
  const send = trpc.contracts.send.useMutation({
    onSuccess: (result) => {
      setSendResult(result);
      const composeUrl = result.channel === "whatsapp" ? result.waLink : result.emailDraftUrl;
      if (composeWindow.current && composeUrl) composeWindow.current.location.href = composeUrl;
      composeWindow.current = null;
      utils.contracts.list.invalidate();
      if (contract?.id) utils.whatsapp.listByContract.invalidate({ contractId: contract.id });
      toast.success(result.channel === "whatsapp" ? "WhatsApp is ready. Review and send the message." : "Gmail draft is ready. Review and send the email.");
      setSending(null);
    },
    onError: (error) => { toast.error(error.message); setSending(null); },
  });
  const resendCopies = trpc.contracts.resendSignedCopies.useMutation({ onSuccess: async (result) => {
    if (resendWindow.current) resendWindow.current.location.href = result.gmailDraftUrl;
    resendWindow.current = null;
    try {
      if (!contract?.id) return;
      const pdf = await utils.client.contracts.downloadPdf.query({ id: contract.id });
      downloadBase64Pdf(pdf.content, pdf.filename);
      toast.success("Gmail draft opened and signed PDF downloaded. Attach the PDF, then send.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "Gmail opened, but the signed PDF could not be downloaded."); }
  }, onError: (error) => { if (resendWindow.current) resendWindow.current.close(); resendWindow.current = null; toast.error(error.message); } });
  const trackRenewals = trpc.renewals.fromContract.useMutation({ onSuccess: ({ created, skipped }) => { utils.renewals.list.invalidate(); toast[created ? "success" : "info"](created ? `${created} renewal${created === 1 ? "" : "s"} added. See the Renewals page.` : skipped ? "These renewals are already being tracked." : "This agreement has no hosting, domain or maintenance terms to track."); }, onError: (error) => toast.error(error.message) });
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
      {!contract.providerSignedAt && contract.status === "draft" && <div className="sign-form panel"><h2>Sign as provider</h2><label>Your name<input value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder="Your full legal name" /></label><span className="panel-subtle">Draw your signature below.</span><SignaturePad onChange={setProviderSignatureImage} /><div className="contract-actions-row"><button className="primary" disabled={!signatureName.trim() || !providerSignatureImage || signProvider.isPending} onClick={() => signProvider.mutate({ id: contract.id, signatureName: signatureName.trim(), signatureImageUrl: providerSignatureImage! })}><PenTool />{signProvider.isPending ? "Signing…" : "Sign agreement"}</button></div></div>}
      {contract.providerSignedAt && (contract.status === "draft" || contract.status === "sent") && <div className="contract-actions-row">
        <button disabled={sending !== null} onClick={() => { composeWindow.current = window.open("about:blank", "_blank"); setSending("email"); send.mutate({ id: contract.id, channel: "email" }); }}><Mail />{sending === "email" ? "Preparing..." : "Open Gmail draft"}</button>
        <button disabled={sending !== null} onClick={() => { composeWindow.current = window.open("about:blank", "_blank"); setSending("whatsapp"); send.mutate({ id: contract.id, channel: "whatsapp" }); }}><MessageCircle />{sending === "whatsapp" ? "Preparing..." : "Open WhatsApp"}</button>
        <button disabled={voidMutation.isPending} onClick={() => { if (window.confirm("Withdraw this agreement? Its signing link stops working and it can no longer be signed.")) voidMutation.mutate({ id: contract.id }); }}><Trash2 />Withdraw</button>
      </div>}
      {sendResult && <>
        <div className="contract-link-box"><ExternalLink size={12} /><span>{sendResult.signingUrl}</span><button className="text-button" onClick={() => copy(sendResult.signingUrl)}><Copy size={11} />Copy</button></div>
        {sendResult.channel === "whatsapp" && sendResult.waLink && <div className="contract-link-box"><MessageCircle size={12} /><span>WhatsApp message prepared. Review and send it in WhatsApp.</span><a className="text-button" href={sendResult.waLink} target="_blank" rel="noreferrer"><ExternalLink size={11} />Open WhatsApp</a></div>}
        {sendResult.channel === "email" && <div className="contract-link-box"><Mail size={12} /><span>Gmail draft prepared. Review and send the email.</span><a className="text-button" href={sendResult.emailDraftUrl} target="_blank" rel="noreferrer"><ExternalLink size={11} />Open Gmail</a></div>}
        <p className="panel-subtle">The draft contains the secure contract signing link. Review it in the opened app and press Send.</p>
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
      {contract.status === "signed" && <div className="contract-actions-row"><button disabled={downloading} onClick={downloadPdf}><FileDown />{downloading ? "Preparing…" : "Download PDF"}</button><button disabled={resendCopies.isPending} onClick={() => { resendWindow.current = window.open("about:blank", "_blank"); resendCopies.mutate({ id: contract.id }); }}><Send />{resendCopies.isPending ? "Preparing…" : "Prepare signed email"}</button></div>}
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
      <div className="contract-actions-row">{contract.status !== "voided" ? <button onClick={() => onCreateInvoice(contract)} title="Start an invoice for the deposit agreed in this contract"><ReceiptText />Create deposit invoice</button> : null}{contract.status === "signed" ? <button disabled={trackRenewals.isPending} onClick={() => trackRenewals.mutate({ contractId: contract.id })} title="Add this agreement's hosting, domain and maintenance terms to Renewals"><CalendarClock />{trackRenewals.isPending ? "Adding…" : "Track renewals"}</button> : null}<button className="contract-delete-button" disabled={deleting} onClick={() => onDelete(contract)}><Trash2 />{deleting ? "Deleting…" : "Delete agreement"}</button></div>
      <div className="contract-document" dangerouslySetInnerHTML={{ __html: contract.documentHtml }} />
    </section>
  </div>;
}

function ContractsPage({ query, onCreateInvoice }: { query: string; onCreateInvoice: (contract: ContractRecord) => void }) {
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
  const needle = query.trim().toLowerCase();
  const visible = needle ? contracts.filter((c) => `${c.title} ${c.fields.projectName} ${c.clientName} ${c.clientEmail || ""} ${c.status}`.toLowerCase().includes(needle)) : contracts;
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
      <tbody>{list.isLoading ? <tr><td colSpan={6} className="activity-empty">Loading agreements…</td></tr> : contracts.length === 0 ? <tr><td colSpan={6} className="activity-empty">No agreements yet. Create one to get started.</td></tr> : visible.length === 0 ? <tr><td colSpan={6} className="activity-empty">No agreements match your search.</td></tr> : visible.map((c) => <tr key={c.id} className="clickable" onClick={() => setViewingId(c.id)}>
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
    <ContractViewDialog contract={viewingContract} onClose={() => setViewingId(null)} onDelete={deleteAgreement} deleting={remove.isPending} onCreateInvoice={(contract) => { setViewingId(null); onCreateInvoice(contract); }} />
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

    // Invoice rows: [4] total, [6] status tone, [7] balance still owed. Drafts and voided invoices aren't billed.
    const invoiced = invoiceRows.filter((r) => r[6] !== "draft" && r[6] !== "void");
    const totalInvoiced = invoiced.reduce((sum, r) => sum + parseAmount(r[4]), 0);
    const totalCollected = invoiced.reduce((sum, r) => sum + Math.max(0, parseAmount(r[4]) - parseAmount(r[7] ?? (r[6] === "paid" ? "0" : r[4]))), 0);
    const collectionRate = totalInvoiced > 0 ? (totalCollected / totalInvoiced) * 100 : null;

    const profitMargin = mtdIncome > 0 ? Math.max(0, Math.min(100, ((mtdIncome - mtdExpense) / mtdIncome) * 100)) : null;

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const projectStage = (r: EditableRow) => (r[3] || "").toLowerCase();
    const activeProjects = projectRows.filter((r) => !projectStage(r).includes("cancel"));
    const onTimeProjects = activeProjects.filter((r) => { if (projectStage(r).includes("complete")) return true; const due = parseRowDate(r[5]); return due ? due >= startOfToday : true; });
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

/** Builds a CSV file from headers + rows and starts the download. */
function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers, ...rows].map((row) => row.map((cell) => csvCell(String(cell))).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); URL.revokeObjectURL(url);
  toast.success(`${filename} downloaded`);
}

function ReportsPage({ invoiceRows, transactionRows, projectRows, leadRows, clientRows, paymentRows }: { invoiceRows: EditableRow[]; transactionRows: EditableRow[]; projectRows: EditableRow[]; leadRows: EditableRow[]; clientRows: EditableRow[]; paymentRows: EditableRow[] }) {
  const health = useBusinessHealth(invoiceRows, transactionRows, projectRows, leadRows);
  const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const stamp = new Date().toISOString().slice(0, 10);
  const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
  const balance = (row: EditableRow) => parseAmount(row[7] ?? row[4]);
  const receivables = invoiceRows.filter((row) => row[6] === "pending" || row[6] === "overdue");
  const daysLate = (row: EditableRow) => { const due = parseRowDate(row[3]); return due ? Math.floor((startOfToday.getTime() - due.getTime()) / 86_400_000) : 0; };
  const agingBuckets = [
    { label: "Not yet due", test: (days: number) => days <= 0 },
    { label: "1–30 days", test: (days: number) => days >= 1 && days <= 30 },
    { label: "31–60 days", test: (days: number) => days >= 31 && days <= 60 },
    { label: "61–90 days", test: (days: number) => days >= 61 && days <= 90 },
    { label: "Over 90 days", test: (days: number) => days > 90 },
  ].map((bucket) => { const rows = receivables.filter((row) => bucket.test(daysLate(row))); return { ...bucket, count: rows.length, amount: rows.reduce((sum, row) => sum + balance(row), 0) }; });
  const receivableTotal = agingBuckets.reduce((sum, bucket) => sum + bucket.amount, 0);
  const same = (a: string | undefined, b: string | undefined) => (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
  const exports = [
    { name: "Income & expenses by month", detail: "Last 12 months of income, expenses and net profit from Accounting.", count: transactionRows.length, run: () => downloadCsv(`income-expenses-${stamp}.csv`, ["Month", "Income (KSh)", "Expenses (KSh)", "Net (KSh)"], monthlySeriesFromTransactions(transactionRows, 12).map((m) => [m.key.replace(/-(\d+)$/, (_, month) => `-${String(Number(month) + 1).padStart(2, "0")}`), Math.round(m.revenue * 1000), Math.round(m.expense * 1000), Math.round((m.revenue - m.expense) * 1000)])) },
    { name: "Receivables aging", detail: "Every unpaid invoice with its balance and how many days it is past due.", count: receivables.length, run: () => downloadCsv(`receivables-aging-${stamp}.csv`, ["Invoice", "Client", "Issued", "Due", "Total", "Balance", "Status", "Days past due"], receivables.map((row) => [row[0], row[1], row[2], row[3], row[4], row[7] ?? row[4], row[5], Math.max(0, daysLate(row))])) },
    { name: "Client statements", detail: "Per client: invoiced, received, outstanding, projects and payments.", count: clientRows.length, run: () => downloadCsv(`client-statements-${stamp}.csv`, ["Client", "Primary contact", "Email", "Phone", "Invoiced (KSh)", "Received (KSh)", "Outstanding (KSh)", "Projects", "Payments"], clientRows.map((client) => { const invoices = invoiceRows.filter((row) => same(row[1], client[0]) && row[6] !== "draft" && row[6] !== "void"); const invoiced = invoices.reduce((sum, row) => sum + parseAmount(row[4]), 0); const outstanding = invoices.filter((row) => row[6] === "pending" || row[6] === "overdue").reduce((sum, row) => sum + balance(row), 0); return [client[0], client[1], client[2], client[3], invoiced, invoiced - outstanding, outstanding, projectRows.filter((row) => same(row[1], client[0])).length, paymentRows.filter((row) => same(row[1], client[0])).length]; })) },
    { name: "Project status", detail: "Every project with client, progress, status, due date and value.", count: projectRows.length, run: () => downloadCsv(`projects-${stamp}.csv`, ["Project", "Client", "Progress %", "Status", "Due date", "Value"], projectRows.map((row) => [row[0], row[1], row[2], row[3], row[5], row[6]])) },
    { name: "Sales pipeline", detail: "Leads with company, contact details, source, value, stage and owner.", count: leadRows.length, run: () => downloadCsv(`sales-pipeline-${stamp}.csv`, ["Lead", "Company", "Email", "Phone", "Source", "Value", "Stage", "Assigned to"], leadRows.map((row) => [row[0], row[1], row[7] || "", row[8] || "", row[2], row[3], row[4], row[6] || ""])) },
    { name: "Payments received", detail: "Every payment with client, invoice, date, amount, method and status.", count: paymentRows.length, run: () => downloadCsv(`payments-${stamp}.csv`, ["Payment", "Client", "Invoice", "Date", "Amount", "Method", "Status"], paymentRows.map((row) => row.slice(0, 7))) },
  ];
  return <div className="page-content"><PageHeader title="Reports" subtitle="Measure financial health, delivery, and growth" /><section className="report-hero"><div className="panel report-highlight"><div className="report-highlight-top"><span className="eyebrow">{monthLabel} performance snapshot</span><FileBarChart /></div><strong>{formatKsh(health.mtdIncome)}</strong><p>Income received this month</p>{health.revenueChange !== null ? <div className="report-trend">{health.revenueChange >= 0 ? <TrendingUp /> : <TrendingDown />}{Math.abs(health.revenueChange).toFixed(1)}% compared with last month</div> : <p className="panel-subtle">No prior-month data yet to compare against</p>}</div><div className="panel report-score"><div><span className="eyebrow">Business health score</span>{health.score !== null ? <strong>{health.score}<span>/100</span></strong> : <strong style={{ fontSize: "1.1rem" }}>Not enough data</strong>}<p>{health.score !== null ? `Averaged across ${health.scoredCount} of 4 tracked indicators` : "Add invoices, transactions, projects, or decided leads to see a score"}</p></div>{health.score !== null && <div className="score-orb"><span>{health.score}</span></div>}</div><div className="panel report-bars"><span className="eyebrow">Core indicators</span>{health.components.map((item) => <div className="report-bar" key={item.label}><span>{item.label}</span><div><i style={{ width: `${item.value ?? 0}%`, background: item.value !== null ? item.color : "rgba(255,255,255,.08)" }} /></div><strong>{item.value !== null ? `${Math.round(item.value)}%` : "-"}</strong></div>)}</div></section><section className="bottom-panels report-panels"><div className="panel"><div className="panel-head"><h2 className="panel-title">Receivables aging</h2><span className="panel-subtle">{formatKsh(receivableTotal)} outstanding</span></div><div className="ledger-summary">{agingBuckets.map((bucket) => <div className="ledger-row" key={bucket.label}><span>{bucket.label} <small className="panel-subtle">({bucket.count})</small></span><strong className={bucket.label !== "Not yet due" && bucket.amount > 0 ? "danger" : undefined}>{formatKsh(bucket.amount)}</strong></div>)}</div></div><div className="panel"><div className="panel-head"><h2 className="panel-title">Report exports</h2><span className="panel-subtle">CSV · opens in Excel or Google Sheets</span></div><div className="report-exports">{exports.map((item) => <div className="report-export" key={item.name}><div><strong>{item.name}</strong><span>{item.detail}</span></div><button className="record-history" onClick={item.run} disabled={!item.count} title={item.count ? undefined : "No records yet"}><FileDown />Download</button></div>)}</div></div></section><WebsiteTrafficPanel /></div>;
}

function AssistantPage({ invoices, inventory, projects, transactions }: { invoices: EditableRow[]; inventory: EditableRow[]; projects: EditableRow[]; transactions: EditableRow[] }) {
  const prompts = ["Which invoices need follow-up this week?", "What is low or out of stock?", "How are active projects progressing?", "What should I prioritize today?"];
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<{ role: "assistant" | "member"; text: string }[]>([{ role: "assistant", text: "I’m ready to help with invoices, projects, inventory, and recent accounting activity. Ask a question or choose a suggested prompt." }]);
  const chat = trpc.insight.chat.useMutation({
    onSuccess: (result) => setMessages((current) => current.concat({ role: "assistant", text: result.answer })),
    onError: (error) => setMessages((current) => current.concat({ role: "assistant", text: error.data?.code === "TOO_MANY_REQUESTS" ? "You’ve asked a lot of questions in a short time. Please wait a few minutes and try again." : "I couldn’t reach the server-side assistant just now. Please try again in a moment." })),
  });
  const respond = (question: string) => {
    const content = question.trim();
    if (!content || chat.isPending) return;
    const outgoing = messages.concat({ role: "member" as const, text: content });
    setMessages(outgoing);
    setInput("");
    // The server accepts at most 50 rows of 12 short cells per table and the last 12 messages, so
    // send the most recent slice (without internal record ids) instead of failing on a big workspace.
    const trim = (rows: EditableRow[]) => rows.slice(-50).map((row) => row.filter((cell) => !isRecordId(cell)).slice(0, 12).map((cell) => cell.slice(0, 500)));
    chat.mutate({
      messages: outgoing.slice(-12).map((message) => ({ role: message.role === "assistant" ? "assistant" as const : "user" as const, content: message.text.slice(0, 4000) })),
      context: { invoices: trim(invoices), inventory: trim(inventory), projects: trim(projects), transactions: trim(transactions) },
    });
  };
  return <div className="page-content"><PageHeader title="AI Assistant" subtitle="Ask 4S Insight about your business operations" /><section className="assistant-grid"><div className="panel assistant-main"><div className="assistant-orb"><Bot /></div><span className="assistant-kicker">4S Insight · Operations copilot</span><h2>What needs your attention?</h2><p>Ask for practical operational analysis. Your workspace records are securely summarized for the server-side AI response.</p><div className="assistant-brief"><div><span><CircleAlert />Priority signal</span><strong>{invoices.filter((row) => /overdue/i.test(row[5] || "")).length || "No"} overdue invoices in the current table.</strong><button disabled={chat.isPending} onClick={() => respond("Which invoices need follow-up this week?")}>Review follow-up list <ChevronRight /></button></div><div><span><Lightbulb />Opportunity</span><strong>{inventory.filter((row) => /low stock|out of stock/i.test(row[6] || "")).length || "No"} inventory alerts need review.</strong><button disabled={chat.isPending} onClick={() => respond("What is low or out of stock?")}>Review stock risk <ChevronRight /></button></div></div><div className="assistant-chat" aria-live="polite">{messages.map((message, index) => <div className={`chat-message ${message.role}`} key={`${message.role}-${index}`}><span>{message.role === "assistant" ? "4S Insight" : "You"}</span><p>{message.text}</p></div>)}{chat.isPending ? <div className="chat-message assistant" role="status" aria-live="polite"><span>4S Insight</span><p className="assistant-typing" aria-label="4S Insight is typing">Analyzing your workspace data<span className="typing-dots" aria-hidden="true"><i>·</i><i>·</i><i>·</i></span></p></div> : null}</div><div className="assistant-input"><Sparkles /><input disabled={chat.isPending} value={input} onChange={(event) => setInput(event.target.value)} aria-label="Ask 4S Insight" placeholder="Ask about clients, cash flow, projects, or performance…" onKeyDown={(event) => { if (event.key === "Enter") respond(input); }} /><button disabled={chat.isPending || !input.trim()} aria-label="Send question" onClick={() => respond(input)}><Send /></button></div></div><aside className="assistant-side"><div className="panel assistant-status"><div className="panel-head"><h2 className="panel-title">Data status</h2><span className="status active">Ready</span></div><div className="status-list"><div><Database /><span>Workspace records</span><strong>{invoices.length + inventory.length + projects.length + transactions.length}</strong></div><div><RefreshCw /><span>Response source</span><strong>Server AI</strong></div><div><HardDrive /><span>Persistence</span><strong>Workspace database</strong></div></div></div><div className="panel prompt-card"><span className="eyebrow">Suggested prompts</span>{prompts.map((prompt) => <button disabled={chat.isPending} key={prompt} onClick={() => respond(prompt)}>{prompt}<ChevronRight /></button>)}</div></aside></section></div>;
}

function SettingsWorkspace() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [tab, setTab] = useState("Business profile");
  const tabs = [{ label: "Business profile", icon: Building2 }, { label: "Integrations", icon: Webhook }, { label: "Billing", icon: CreditCard }, { label: "My account", icon: UserRound }];
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
  const panel = tab === "Business profile" ? <div className="panel settings-card"><div className="settings-card-head"><div><h2>Business profile</h2><p>Details used on invoices, quotes, and reporting.</p></div><img src={logo} alt="45Creatives Agency" /></div>{profileQuery.isLoading ? <p className="panel-subtle">Loading…</p> : <div className="settings-fields"><label>Business name<input value={form.name} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></label><label>Primary email<input type="email" value={form.businessEmail} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, businessEmail: e.target.value }))} /></label><label>Phone number<input value={form.businessPhone} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, businessPhone: e.target.value }))} /></label><label>Currency<input value="KES - Kenyan shilling" readOnly title="All amounts in the CRM, invoices and agreements are in Kenyan shillings" /></label><label className="wide">Business address<input value={form.businessAddress} disabled={!isAdmin} onChange={(e) => setForm((f) => ({ ...f, businessAddress: e.target.value }))} /></label></div>}{!isAdmin && <p className="panel-subtle">Only workspace admins can edit the business profile.</p>}</div> : tab === "Integrations" ? <><div className="panel settings-card"><h2>Website lead capture</h2><p>Send your website's contact-form submissions here and they'll show up as new Leads automatically - no manual re-entry.</p>{!isAdmin ? <p className="panel-subtle">Only workspace admins can view integration credentials.</p> : webhookQuery.isLoading ? <p className="panel-subtle">Loading…</p> : webhookQuery.data ? <div className="settings-fields"><label className="wide">Webhook URL<div className="contract-link-box"><Webhook size={12} /><span>{webhookQuery.data.url}</span><button className="text-button" type="button" onClick={() => copy(webhookQuery.data!.url, "Webhook URL")}><Copy size={11} />Copy</button></div></label><label className="wide">Secret (send as the <code>X-Webhook-Secret</code> header)<div className="contract-link-box"><ShieldCheck size={12} /><span>{webhookQuery.data.secret}</span><button className="text-button" type="button" onClick={() => copy(webhookQuery.data!.secret, "Secret")}><Copy size={11} />Copy</button></div></label><label className="wide">Example request<pre className="webhook-snippet">{curlSnippet}</pre></label></div> : null}<p className="panel-subtle">POST <code>{"{ name, email, phone, message, source }"}</code> as JSON from your site's form handler, a Zapier/Make webhook step, or a WordPress plugin like WPForms/Contact Form 7's webhook add-on - whatever your website runs on. Every submission becomes a new Lead with the source labeled "Website contact form", and you'll get an email notification if a business email is set on this workspace.</p></div><MpesaIntegration isAdmin={isAdmin} /></> : tab === "Billing" ? <BillingSettings isAdmin={isAdmin} /> : <div className="panel settings-card"><h2>My account</h2><p>Your profile, sign-out and account removal are below. Use “Profile” to change your display name or picture.</p></div>;
  return <div className="page-content"><PageHeader title="Settings" subtitle="Manage your workspace, preferences, and integrations" action={tab === "Business profile" && isAdmin ? (saveProfile.isPending ? "Saving…" : "Save Changes") : undefined} onAction={tab === "Business profile" && isAdmin ? () => saveProfile.mutate({ name: form.name.trim(), businessEmail: form.businessEmail.trim() || null, businessPhone: form.businessPhone.trim() || null, businessAddress: form.businessAddress.trim() || null }) : undefined} /><section className="settings-layout"><div className="settings-tabs panel">{tabs.map(({ label, icon: Icon }) => <button key={label} className={tab === label ? "active" : ""} onClick={() => setTab(label)}><Icon />{label}</button>)}</div><div className="settings-content">{panel}</div></section></div>;
}
function PlaceholderPage({ page }: { page: string }) { const Icon = page === "AI Assistant" ? Sparkles : page === "Settings" ? Settings : page === "Inventory" ? Archive : ClipboardList; return <div className="page-content"><PageHeader title={page} subtitle="Your workspace is ready for the next workflow." /><div className="panel empty-page"><div><div className="empty-icon"><Icon /></div><h2>{page} workspace</h2><p>This operational area is staged and connected to the same dark management shell. Use the side navigation to explore live client, project, invoicing, and payment records.</p></div></div></div>; }

function AccountingBulkPage({ query, rows, onEdit, onCreate, onDelete, onBulkEdit, onBulkDelete }: { query: string; rows: EditableRow[]; onEdit: (index: number) => void; onCreate: () => void; onDelete: (index: number) => void; onBulkEdit: (indices: number[], value: string) => void; onBulkDelete: (indices: number[]) => void }) {
  const discovery = useTableDiscovery(rows, 3, query);
  const selection = useBulkSelection();
  const visibleIndices = discovery.visibleRows.map(({ index }) => index);
  const { mtdIncome, mtdExpense, lastMonthIncome, lastMonthExpense } = monthlyIncomeExpense(rows);
  const revenueChange = lastMonthIncome > 0 ? ((mtdIncome - lastMonthIncome) / lastMonthIncome) * 100 : null;
  const profitChange = lastMonthIncome - lastMonthExpense !== 0 ? (((mtdIncome - mtdExpense) - (lastMonthIncome - lastMonthExpense)) / Math.abs(lastMonthIncome - lastMonthExpense)) * 100 : null;
  const profitData = useMemo(() => monthlySeriesFromTransactions(rows, 6), [rows]);
  const sign = (row: EditableRow) => row[5] === "positive" ? "+" : row[5] === "negative" ? "−" : "";
  return <div className="page-content"><PageHeader title="Accounting" subtitle="Monitor revenue, costs, and working capital" action="New Entry" onAction={onCreate} /><section className="metric-grid"><MetricCard label="Revenue (MTD)" value={formatKsh(mtdIncome)} meta={revenueChange !== null ? `${revenueChange >= 0 ? "↑" : "↓"} ${Math.abs(revenueChange).toFixed(1)}% versus last month` : "No data for last month"} /><MetricCard label="Operating Expenses" value={formatKsh(mtdExpense)} meta={mtdIncome > 0 ? `${((mtdExpense / mtdIncome) * 100).toFixed(1)}% of revenue` : undefined} /><MetricCard label="Net Operating Profit" value={formatKsh(mtdIncome - mtdExpense)} meta={profitChange !== null ? `${profitChange >= 0 ? "↑" : "↓"} ${Math.abs(profitChange).toFixed(1)}% month on month` : "No data for last month"} tone={mtdIncome - mtdExpense < 0 ? "danger" : "success"} /></section><section className="accounting-grid"><div className="panel"><div className="panel-head"><h2 className="panel-title">Income vs. Expenses</h2><span className="panel-subtle">Last 6 months</span></div><div className="chart-wrap accounting-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={profitData} margin={{ top: 8, right: 5, left: -19, bottom: 0 }}><CartesianGrid stroke="rgba(255,255,255,.07)" vertical={false} strokeDasharray="3 3" /><XAxis dataKey="m" axisLine={false} tickLine={false} tick={{ fill: "#9ca2a8", fontSize: 9 }} dy={9} /><YAxis axisLine={false} tickLine={false} tick={{ fill: "#9ca2a8", fontSize: 8 }} tickFormatter={(value) => `${value}K`} /><Tooltip contentStyle={{ background: "#15171a", border: "1px solid rgba(255,255,255,.1)", borderRadius: 7, fontSize: 10 }} labelStyle={{ color: "#b7babc" }} formatter={(value, key) => [formatKsh((value as number) * 1000), key === "revenue" ? "Income" : "Expenses"]} /><Area isAnimationActive={false} type="monotone" dataKey="revenue" stroke="#76c991" strokeWidth={2} fill="rgba(118,201,145,.12)" /><Area isAnimationActive={false} type="monotone" dataKey="expense" stroke="#df676a" strokeWidth={2} fill="rgba(223,103,106,.1)" /></AreaChart></ResponsiveContainer></div></div><div className="panel ledger-summary"><div className="panel-head"><h2 className="panel-title">Ledger Summary</h2><Landmark size={14} color="#a8afb5" /></div><div className="ledger-row"><span>Income (MTD)</span><strong>{formatKsh(mtdIncome)}</strong></div><div className="ledger-row"><span>Expenses (MTD)</span><strong>{formatKsh(mtdExpense)}</strong></div><div className="ledger-row ledger-total"><span>Cash movement</span><strong>{formatKsh(mtdIncome - mtdExpense)}</strong></div><p className="panel-subtle">Transfers between your own accounts are listed but don’t count as income or expenses.</p></div></section><div className="panel table-panel"><div className="panel-head"><h2 className="panel-title">Transactions</h2><span className="panel-subtle">Completed payments post here automatically</span></div><TableDiscovery placeholder="Search transactions…" search={discovery.search} onSearch={discovery.setSearch} filter={discovery.filter} onFilter={discovery.setFilter} options={discovery.options} countLabel={`${discovery.filteredCount} transaction${discovery.filteredCount === 1 ? "" : "s"} found`} /><BulkActions bulkLabel="Bulk type" selectedCount={selection.selected.size} options={transactionTypeOptions} onEdit={(value) => { onBulkEdit(Array.from(selection.selected), value); selection.clear(); }} onDelete={() => { onBulkDelete(Array.from(selection.selected)); selection.clear(); }} onClear={selection.clear} /><div className="table-scroller"><table className="data-table editable-table"><thead><tr><th><TableCheckbox checked={visibleIndices.length > 0 && visibleIndices.every((index) => selection.selected.has(index))} onChange={() => selection.toggleAll(visibleIndices)} label="Select all visible transactions" /></th><th>Date</th><th>Reference</th><th>Description</th><th>Type</th><th>Amount</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={7} className="activity-empty">No transactions yet. Add your first entry to get started.</td></tr> : discovery.visibleRows.length === 0 ? <tr><td colSpan={7} className="activity-empty">No transactions match your search.</td></tr> : discovery.visibleRows.map(({ row: r, index }) => <tr key={getRecordId(r) || index}><td><TableCheckbox checked={selection.selected.has(index)} onChange={() => selection.toggle(index)} label={`Select ${r[1]}`} /></td><td>{r[0]}</td><td className="strong-cell">{r[1] || "-"}</td><td>{r[2]}</td><td><Status label={r[3]} tone={r[5] === "positive" ? "active" : r[5] === "neutral" ? "sent" : "overdue"} /></td><td className={`value-cell ${r[5] === "negative" ? "danger" : ""}`}>{sign(r)}{r[4]}</td><td><RecordActions row={r} onEdit={() => onEdit(index)} onDelete={() => onDelete(index)} /></td></tr>)}</tbody></table></div><Pagination page={discovery.page} totalPages={discovery.totalPages} onPageChange={discovery.setPage} /></div></div>;
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
  const [inviteLink, setInviteLink] = useState<{ email: string; url: string; note: string | null } | null>(null);
  const refresh = () => { users.refetch(); invitations.refetch(); };
  const setRole = trpc.admin.setRole.useMutation({ onSuccess: () => { toast.success("Role updated"); refresh(); }, onError: (error) => { toast.error(error.message); refresh(); } });
  const setRoles = trpc.admin.setRoles.useMutation({ onSuccess: ({ updated }) => { toast.success(`${updated} workspace role${updated === 1 ? "" : "s"} updated`); setSelected(new Set()); refresh(); }, onError: (error) => toast.error(error.message) });
  const invite = trpc.admin.invite.useMutation({ onSuccess: (result) => { setInviteLink({ email: result.invitation.email, url: result.inviteUrl, note: result.deliveryError }); if (result.delivered) toast.success(`Invitation emailed to ${result.invitation.email}`); else toast.info("Invitation created. Copy the link and share it."); setEmail(""); refresh(); }, onError: (error) => toast.error(error.message) });
  if (user?.role !== "admin") return null;
  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });
  // The owner's role is fixed, so they can't be picked for a bulk change.
  const members = users.data || [];
  const selectable = members.filter((member) => member.role !== "owner");
  const copy = (value: string) => { navigator.clipboard?.writeText(value).then(() => toast.success("Invitation link copied")).catch(() => toast.error("Could not copy")); };
  return <div className="page-content"><div className="panel settings-card role-admin-panel"><div className="settings-card-head"><div><h2>Role management</h2><p>Select team members for a bulk permission change, or invite someone new. Administrators can manage roles, integrations and the business profile.</p></div><Users /></div><div className="role-toolbar"><label><input type="checkbox" checked={selectable.length > 0 && selectable.every((member) => selected.has(member.id))} onChange={() => setSelected((current) => current.size === selectable.length ? new Set() : new Set(selectable.map((member) => member.id)))} />Select all</label><select value={bulkRole} onChange={(event) => setBulkRole(event.target.value as "admin" | "member")} aria-label="Bulk workspace role"><option value="member">User</option><option value="admin">Administrator</option></select><button disabled={!selected.size || setRoles.isPending} onClick={() => setRoles.mutate({ userIds: Array.from(selected), role: bulkRole })}>{setRoles.isPending ? <RefreshCw className="animate-spin" /> : <Check />}{setRoles.isPending ? "Updating roles…" : `Assign role to ${selected.size || "selected"}`}</button></div><div className="role-member-list">{users.isLoading ? <span className="panel-subtle">Loading workspace users…</span> : members.map((member) => <div className="role-member" key={member.id}><input type="checkbox" checked={selected.has(member.id)} disabled={member.role === "owner"} onChange={() => toggle(member.id)} aria-label={`Select ${member.name || member.email || member.id}`} /><span>{member.name || member.email || `User ${member.id}`}{member.id === user.id ? " (you)" : ""}</span><small>{member.email || "No email recorded"}</small>{member.role === "owner" ? <span className="panel-subtle" title="The workspace owner always has full access">Owner</span> : <select value={member.role} disabled={setRole.isPending} onChange={(event) => setRole.mutate({ userId: member.id, role: event.target.value as "admin" | "member" })}><option value="member">User</option><option value="admin">Administrator</option></select>}</div>)}</div><form className="invite-form" onSubmit={(event) => { event.preventDefault(); invite.mutate({ email: email.trim(), role: inviteRole }); }}><div><h3>Invite a team member</h3><p>They get a link to set a password and join this workspace. Links expire after 7 days.</p></div><input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="new.member@agency.com" aria-label="Invitee email" /><select value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "admin" | "member")} aria-label="Invitee role"><option value="member">User</option><option value="admin">Administrator</option></select><button disabled={invite.isPending}>{invite.isPending ? <RefreshCw className="animate-spin" /> : <Send />}{invite.isPending ? "Sending invite…" : "Send invite"}</button></form>{inviteLink ? <div className="invite-link"><span className="panel-subtle">{inviteLink.note || `Invitation emailed to ${inviteLink.email}. You can also share the link directly:`}</span><div className="contract-link-box"><ExternalLink size={12} /><span>{inviteLink.url}</span><button className="text-button" type="button" onClick={() => copy(inviteLink.url)}><Copy size={11} />Copy</button></div></div> : null}<div className="invitation-history"><h3>Invitations</h3>{invitations.data?.length ? invitations.data.slice(0, 8).map((invitation) => <div key={invitation.id}><span>{invitation.email}</span><small>{invitation.role === "admin" ? "Administrator" : "User"}</small><Status label={invitation.status} tone={invitation.status === "accepted" ? "active" : invitation.status === "expired" || invitation.status === "revoked" ? "overdue" : "pending"} /></div>) : <p className="activity-empty">No invitations have been sent yet.</p>}</div></div></div>;
}

function AccountLifecyclePanel({ openRequest }: { openRequest: number }) {
  const { user, loading, logout, refresh } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [name, setName] = useState("");
  const profile = trpc.auth.profile.useQuery(undefined, { enabled: Boolean(user) });
  // "Edit profile" on the dashboard sends people here and bumps `openRequest` to open the dialog.
  useEffect(() => { if (openRequest && user) { setName(profile.data?.displayName || user.name || ""); setProfileOpen(true); } }, [openRequest, user]);
  const deleteAccount = trpc.auth.deleteAccount.useMutation({ onSuccess: async () => { toast.success("Account deleted"); await logout(); }, onError: (error) => toast.error(error.message) });
  const updateProfile = trpc.auth.updateProfile.useMutation({ onSuccess: async () => { notifyProfileMutation(toast, "success"); await refresh(); profile.refetch(); setProfileOpen(false); }, onError: () => notifyProfileMutation(toast, "error") });
  const uploadAvatar = trpc.auth.uploadAvatar.useMutation({ onSuccess: () => { toast.success("Profile picture updated"); profile.refetch(); }, onError: (error) => toast.error(error.message) });
  const removeAvatar = trpc.auth.removeAvatar.useMutation({ onSuccess: () => { toast.success("Custom avatar removed"); profile.refetch(); }, onError: (error) => toast.error(error.message) });
  const selectAvatar = (file?: File) => { if (!file) return; if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 2 * 1024 * 1024) { toast.error("Choose a PNG, JPEG, or WebP image under 2 MB."); return; } const reader = new FileReader(); reader.onload = () => uploadAvatar.mutate({ dataUrl: String(reader.result) }); reader.onerror = () => toast.error("Unable to read that image."); reader.readAsDataURL(file); };
  if (!user) return <div className="page-content"><div className="panel settings-card account-panel"><h2>Account access</h2><p>Sign in to synchronize workspace data, manage roles, and access your account controls.</p><button className="heading-action" onClick={() => startLogin()} disabled={loading}>Sign in to workspace</button></div></div>;
  const avatar = profile.data?.avatarUrl || profile.data?.providerImageUrl || user.providerImageUrl || nadia;
  return <><div className="page-content"><div className="panel settings-card account-panel"><div><h2>Account access</h2><p>Signed in as {profile.data?.displayName || user.email || user.name || "workspace user"}.</p></div><div className="account-actions"><button className="record-history" onClick={() => { setName(profile.data?.displayName || user.name || ""); setProfileOpen(true); }}>Profile</button><button className="record-history" onClick={() => logout().catch((error) => toast.error(error instanceof Error ? error.message : "Unable to sign out"))} disabled={loading}>Sign out</button><button className="record-delete" onClick={() => { if (window.prompt("Type DELETE MY ACCOUNT to permanently remove your workspace account.") === "DELETE MY ACCOUNT") deleteAccount.mutate({ confirmation: "DELETE MY ACCOUNT" }); }} disabled={deleteAccount.isPending}>Delete account</button></div></div></div>{profileOpen ? <div className="record-dialog-backdrop" onMouseDown={() => setProfileOpen(false)}><section className="record-dialog panel" role="dialog" aria-modal="true" aria-labelledby="profile-title" onMouseDown={(event) => event.stopPropagation()}><div className="record-dialog-head"><div><span className="eyebrow">Workspace profile</span><h2 id="profile-title">Your profile</h2></div><button className="record-close" aria-label="Close profile" onClick={() => setProfileOpen(false)}><X /></button></div><div className="record-fields"><label className="wide">Profile picture<div className="profile-avatar-picker"><img src={avatar} alt="Current profile avatar" /><input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploadAvatar.isPending || removeAvatar.isPending} onChange={(event) => selectAvatar(event.target.files?.[0])} />{uploadAvatar.isPending || removeAvatar.isPending ? <RefreshCw className="animate-spin" /> : <span>Choose image</span>}</div><button className="record-reset" type="button" disabled={!profile.data?.avatarUrl || removeAvatar.isPending} onClick={() => removeAvatar.mutate()}>Remove custom avatar</button></label><label>Display name<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>Assigned role<input value={profile.data?.role === "admin" ? "Administrator" : "Team member"} readOnly /></label><label className="wide">Email<input value={user.email || "Not available"} readOnly /></label><label className="wide">Last sign-in<input value={profile.data?.lastSignedIn ? new Date(profile.data.lastSignedIn).toLocaleString() : (user.lastSignedIn ? new Date(user.lastSignedIn).toLocaleString() : "Not available")} readOnly /></label></div><div className="record-dialog-actions"><button className="record-reset" onClick={() => setProfileOpen(false)}>Cancel</button><button className="record-save" disabled={updateProfile.isPending || !name.trim()} onClick={() => updateProfile.mutate(buildProfileUpdateInput(name, ""))}>{updateProfile.isPending ? "Saving…" : "Save profile"}</button></div></section></div> : null}</>;
}

type ServerRecord = { id: string; tableName: string; recordData: string[] };
type RecordRowInput = { id: string; tableName: string; recordData: string[] };
/** Pages with their own table; on any other page the top search shows workspace-wide results. */
const pagesWithTables = new Set<PageKey>(["Clients", "Leads", "Projects", "Quotes", "Invoices", "Payments", "Inventory", "Accounting", "Contracts", "Renewals"]);
const rowSignature = (row: EditableRow) => JSON.stringify(row.filter((cell) => !isRecordId(cell)));

export default function Home() {
  const { user, loading: authLoading } = useAuth();
  // Nothing in the dashboard is kept without an account, so a signed-out visitor goes to sign in.
  useEffect(() => { if (!authLoading && !user) startLogin(); }, [authLoading, user]);
  const [page, setPage] = useState<PageKey>(() => {
    const requestedView = new URLSearchParams(window.location.search).get("view") as PageKey | null;
    return requestedView && knownPages.has(requestedView) ? requestedView : "Dashboard";
  });
  const [query, setQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [invoiceFormOpen, setInvoiceFormOpen] = useState(false);
  const [invoicePrefill, setInvoicePrefill] = useState<Partial<InvoiceFields>>({});
  const [viewingInvoiceId, setViewingInvoiceId] = useState<string | null>(null);
  const [viewingQuoteId, setViewingQuoteId] = useState<string | null>(null);
  const [quoteFormOpen, setQuoteFormOpen] = useState(false);
  const [workProjectId, setWorkProjectId] = useState<string | null>(null);
  const [profileRequest, setProfileRequest] = useState(0);
  const [clientRows, setClientRows] = useStoredRows("4s-creatives:clients", emptyRows);
  const [leadRows, setLeadRows] = useStoredRows("4s-creatives:leads", emptyRows);
  const [projectRows, setProjectRows] = useStoredRows("4s-creatives:projects", emptyRows);
  const [quoteRows, setQuoteRows] = useStoredRows("4s-creatives:quotes", emptyRows);
  const [invoiceRows, setInvoiceRows] = useStoredRows("4s-creatives:invoices", emptyRows);
  const [paymentRows, setPaymentRows] = useStoredRows("4s-creatives:payments", emptyRows);
  const [inventoryRows, setInventoryRows] = useStoredRows("4s-creatives:inventory", emptyRows);
  const [transactionRows, setTransactionRows] = useStoredRows("4s-creatives:transactions", emptyRows);
  const [deletedRecords, setDeletedRecords] = useStoredDeletedRecords("4s-creatives:recently-deleted");
  const [activityEvents, setActivityEvents] = useStoredActivity("4s-creatives:activity-history");
  const [historyTarget, setHistoryTarget] = useState<{ label: string; recordId: string } | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(0);
  const [syncRetry, setSyncRetry] = useState(0);
  const utils = trpc.useUtils();
  const invoiceDefaults = trpc.invoiceDocs.defaults.useQuery(undefined, { enabled: Boolean(user) });
  const createInvoiceDoc = trpc.invoiceDocs.create.useMutation();
  const nextInvoiceNumberQuery = trpc.invoiceDocs.nextNumber.useQuery(undefined, { enabled: Boolean(user && invoiceFormOpen) });
  const removeRecords = trpc.records.remove.useMutation({ onSuccess: () => { utils.records.list.invalidate(); utils.invoiceDocs.summaries.invalidate(); }, onError: (error) => toast.error(`Database delete failed: ${error.message}`) });
  const syncActivity = trpc.activity.append.useMutation();
  const sharedRecords = trpc.records.list.useQuery(undefined, { enabled: Boolean(user) });
  const sharedActivity = trpc.activity.list.useQuery({}, { enabled: user?.role === "admin" });
  const members = trpc.workspace.members.useQuery(undefined, { enabled: Boolean(user) });
  const renewalList = trpc.renewals.list.useQuery(undefined, { enabled: Boolean(user) });
  const workspaceProfile = trpc.workspace.profile.useQuery(undefined, { enabled: Boolean(user) });
  const rates = workspaceProfile.data?.exchangeRates || {};
  const createQuoteDoc = trpc.quoteDocs.create.useMutation();
  const nextQuoteNumberQuery = trpc.quoteDocs.nextNumber.useQuery(undefined, { enabled: Boolean(user && quoteFormOpen) });
  // A session that expired while the app was open sends the user back to sign in.
  useEffect(() => { if (sharedRecords.error?.data?.code === "UNAUTHORIZED") startLogin(); }, [sharedRecords.error]);

  // --- Sync with the workspace database -------------------------------------------------------
  // Each table row is saved only when it actually changed. `syncedSignatures` remembers what the
  // server last stored for every row, and `appliedRows` is the exact array loaded from the server,
  // so reloading never echoes the server's own data back (which used to re-save every record on
  // every page load and overwrite linked fields).
  const tableSetters: Record<string, Dispatch<SetStateAction<EditableRow[]>>> = { clients: setClientRows, leads: setLeadRows, projects: setProjectRows, quotes: setQuoteRows, invoices: setInvoiceRows, payments: setPaymentRows, inventory: setInventoryRows, transactions: setTransactionRows };
  const syncedSignatures = useRef<Record<string, Map<string, string>>>({});
  const appliedRows = useRef<Record<string, EditableRow[]>>({});
  const applyServerRecords = (records: ServerRecord[]) => {
    const grouped = new Map<string, EditableRow[]>();
    records.forEach((record) => grouped.set(record.tableName, [...(grouped.get(record.tableName) || []), [...record.recordData, `${recordMarker}${record.id}`]]));
    for (const [tableName, setter] of Object.entries(tableSetters)) {
      const rows = grouped.get(tableName) || [];
      syncedSignatures.current[tableName] = new Map(rows.map((row) => [getRecordId(row), rowSignature(row)]));
      appliedRows.current[tableName] = rows;
      setter(rows);
    }
  };
  useEffect(() => { if (sharedRecords.data) applyServerRecords(sharedRecords.data); }, [sharedRecords.data]);
  useEffect(() => { if (!sharedActivity.data) return; setActivityEvents((current) => current.length ? current : sharedActivity.data.map((event) => ({ id: event.id, recordId: event.recordId, label: event.recordId, table: event.tableName, action: event.action, detail: event.detail, at: event.createdAt.getTime(), synced: true }))); }, [sharedActivity.data]);
  const pushRows = async (rows: RecordRowInput[]) => {
    setSyncing((count) => count + 1);
    try {
      for (let start = 0; start < rows.length; start += 200) await utils.client.records.sync.mutate(rows.slice(start, start + 200));
      setSyncError(null);
      // Reload what the server stored: linked names, recalculated totals, statuses and the ledger.
      utils.records.list.invalidate(); utils.invoiceDocs.summaries.invalidate(); utils.invoiceDocs.view.invalidate();
    } catch (error) {
      // Forget these rows' signatures so "Retry" sends them again.
      rows.forEach((row) => syncedSignatures.current[row.tableName]?.delete(row.id));
      setSyncError(error instanceof Error ? error.message : "The workspace database could not be reached.");
    } finally { setSyncing((count) => count - 1); }
  };
  // Invoices aren't listed here: they're created and edited through the invoice dialog, and the
  // server works out their totals and status.
  const editableTables = [["clients", clientRows], ["leads", leadRows], ["projects", projectRows], ["quotes", quoteRows], ["payments", paymentRows], ["inventory", inventoryRows], ["transactions", transactionRows]] as const;
  useEffect(() => {
    if (!user || !sharedRecords.data) return;
    const changed: RecordRowInput[] = [];
    for (const [tableName, rows] of editableTables) {
      if (rows === appliedRows.current[tableName]) continue;
      const seen = syncedSignatures.current[tableName] ??= new Map();
      const present = new Set<string>();
      for (const row of rows) {
        const id = getRecordId(row);
        present.add(id);
        const signature = rowSignature(row);
        if (seen.get(id) === signature) continue;
        seen.set(id, signature);
        changed.push({ id, tableName, recordData: row.filter((cell) => !isRecordId(cell)) });
      }
      // Forget deleted rows, so restoring one from the recovery tray saves it again.
      for (const id of Array.from(seen.keys())) if (!present.has(id)) seen.delete(id);
    }
    if (changed.length) void pushRows(changed);
  }, [user, clientRows, leadRows, projectRows, quoteRows, paymentRows, inventoryRows, transactionRows, syncRetry]);
  const discardLocalChanges = async () => { setSyncError(null); const fresh = await sharedRecords.refetch(); if (fresh.data) applyServerRecords(fresh.data); };

  // `synced` is stored on each event (persisted to localStorage via useStoredActivity) rather than
  // kept in separate component state, so a page reload doesn't forget what was already synced and
  // re-send the entire local history - up to 200 events - to the server every time the app loads.
  useEffect(() => { if (!user || syncActivity.isPending) return; const pending = activityEvents.filter((event) => !event.synced); if (!pending.length) return; syncActivity.mutate(pending.map((event) => ({ id: event.id, recordId: event.recordId, tableName: event.table, action: event.action, detail: event.detail })), { onSuccess: () => setActivityEvents((current) => current.map((event) => pending.some((p) => p.id === event.id) ? { ...event, synced: true } : event)), onError: (error) => toast.error(`Activity sync will retry: ${error.message.slice(0, 160)}`) }); }, [user, activityEvents, syncActivity.isPending]);
  const recordActivity = (label: string, table: string, action: string, detail: string, recordId = `${table}:${label}`) => setActivityEvents((current) => [{ id: createRecordId("activity"), recordId, label, table, action, detail, at: Date.now(), synced: false }, ...current].slice(0, 200));
  const openEditor = (title: string, labels: string[], row: EditableRow, onSave: (next: EditableRow, recordId: string) => void, extras: { readOnly?: number[]; options?: FieldOptions } = {}) => { const recordId = getRecordId(row) || createRecordId(title.replace(/^new\s+/i, "")); setEditor({ title, labels, row, readOnly: extras.readOnly, options: extras.options, onSave: (next) => { onSave(next, recordId); const creating = title.toLowerCase().startsWith("new "); recordActivity(next[0] || title, title.replace(/^new\s+/i, ""), creating ? "Created" : "Updated", creating ? "Record created from the editor." : "Record fields updated from the editor.", recordId); } }); };
  /** Appends a new row that keeps the id the editor was opened with, so its history lines up. */
  const withId = (row: EditableRow, recordId: string) => [...row, `${recordMarker}${recordId}`];
  const deleteRecord = (label: string, table: string, row: EditableRow, index: number, setRows: Dispatch<SetStateAction<EditableRow[]>>) => { if (window.confirm(`Delete this ${label}? You can recover it from the recent deletion tray.`)) { setRows((current) => current.filter((_, rowIndex) => rowIndex !== index)); const recordId = getRecordId(row); if (recordId) removeRecords.mutate({ tableName: table, ids: [recordId] }); setDeletedRecords((current) => [{ id: createRecordId("deleted"), label: row[0] || label, table, row, index, deletedAt: Date.now() }, ...current].slice(0, 8)); recordActivity(row[0] || label, table, "Deleted", "Moved to recently deleted records.", getRecordId(row) || `${table}:${row[0] || label}`); toast.success(`${label[0].toUpperCase()}${label.slice(1)} deleted`); } };
  const bulkUpdateRows = (table: string, setRows: Dispatch<SetStateAction<EditableRow[]>>, rows: EditableRow[], indices: number[], update: (row: EditableRow) => EditableRow) => { const selected = new Set(indices); setRows((current) => current.map((row, index) => selected.has(index) ? update(row) : row)); indices.forEach((index) => rows[index] && recordActivity(rows[index][0] || table, table, "Bulk updated", "Updated through the selected-record bulk action.", getRecordId(rows[index]))); toast.success(`${indices.length} record${indices.length === 1 ? "" : "s"} updated`); };
  const bulkDeleteRecords = (label: string, table: string, rows: EditableRow[], indices: number[], setRows: Dispatch<SetStateAction<EditableRow[]>>) => { if (!indices.length || !window.confirm(`Delete ${indices.length} ${label}${indices.length === 1 ? "" : "s"}? Each can be recovered from the recent deletion tray.`)) return; const selected = new Set(indices); const deleted = indices.map((index) => ({ row: rows[index], index })).filter((item): item is { row: EditableRow; index: number } => Boolean(item.row)); setRows((current) => current.filter((_, index) => !selected.has(index))); const idsToDelete = deleted.map((item) => getRecordId(item.row)).filter(Boolean); if (idsToDelete.length) removeRecords.mutate({ tableName: table, ids: idsToDelete }); setDeletedRecords((current) => deleted.map((item) => ({ id: createRecordId("deleted"), label: item.row[0] || label, table, row: item.row, index: item.index, deletedAt: Date.now() })).concat(current).slice(0, 8)); deleted.forEach((item) => recordActivity(item.row[0] || label, table, "Deleted", "Deleted through the selected-record bulk action.", getRecordId(item.row))); toast.success(`${indices.length} records deleted`); };
  const restoreRecord = (record: DeletedRecord) => { const setter = tableSetters[record.table]; if (!setter || record.table === "invoices") { setDeletedRecords((current) => current.filter((item) => item.id !== record.id)); return; } setter((current) => { const next = [...current]; next.splice(Math.min(record.index, next.length), 0, record.row); return next; }); setDeletedRecords((current) => current.filter((item) => item.id !== record.id)); recordActivity(record.label, record.table, "Restored", "Recovered from recently deleted records.", getRecordId(record.row) || `${record.table}:${record.label}`); toast.success(`${record.label} restored`); };
  const dateLabel = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  const year = new Date().getFullYear();

  useEffect(() => {
    const onHistory = (event: Event) => { const detail = (event as CustomEvent<{ label: string; recordId?: string }>).detail; setHistoryTarget({ label: detail.label, recordId: detail.recordId || "" }); };
    const onOpenProfile = () => { setPage("Settings"); setQuery(""); setProfileRequest((count) => count + 1); };
    // Imports follow the column order of the CSV that "Export CSV" produces for the same table.
    const onCsvImport = (event: Event) => {
      const { page: targetPage, rows } = (event as CustomEvent<{ page: string; rows: EditableRow[] }>).detail;
      const usable = rows.filter((row) => row.some((cell) => cell.trim()));
      if (!usable.length) return;
      const imported = (table: string, transform: (row: EditableRow) => EditableRow, setter: Dispatch<SetStateAction<EditableRow[]>>) => { const next = usable.map(transform); setter((current) => current.concat(next)); next.forEach((row) => recordActivity(row[0] || table, table, "Imported", "Added from a CSV import.")); };
      const cell = (row: EditableRow, index: number, fallback = "") => (row[index] ?? "").trim() || fallback;
      switch (targetPage) {
        case "Clients": imported("clients", (row) => [cell(row, 0, "Unnamed client"), cell(row, 1), cell(row, 2), cell(row, 3), "KSh 0", cell(row, 5, "Active"), statusTone(cell(row, 5, "Active"))], setClientRows); break;
        case "Leads": imported("leads", (row) => [cell(row, 0, "Unnamed lead"), cell(row, 1), cell(row, 4), cell(row, 5, "KSh 0"), cell(row, 6, "New"), statusTone(cell(row, 6, "New")), cell(row, 7, "Unassigned"), cell(row, 2), cell(row, 3)], setLeadRows); break;
        case "Projects": imported("projects", (row) => [cell(row, 0, "Unnamed project"), cell(row, 1), String(Number(cell(row, 2, "0").replace("%", "")) || 0), cell(row, 3, "Planning"), statusTone(cell(row, 3, "Planning")), cell(row, 4), cell(row, 5, "KSh 0")], setProjectRows); break;
        case "Quotes": imported("quotes", (row) => [cell(row, 0, `QT-${Date.now()}`), cell(row, 1), cell(row, 2), cell(row, 3, "KSh 0"), cell(row, 4, "Draft"), statusTone(cell(row, 4, "Draft")), cell(row, 5)], setQuoteRows); break;
        case "Payments": imported("payments", (row) => [cell(row, 0, `PAY-${Date.now()}`), cell(row, 1), cell(row, 2), cell(row, 3, dateLabel()), cell(row, 4, "KSh 0"), cell(row, 5), cell(row, 6, "Completed"), statusTone(cell(row, 6, "Completed"))], setPaymentRows); break;
        case "Inventory": imported("inventory", (row) => { const stock = inventoryStock(cell(row, 3, "0")); return [cell(row, 0, "Unnamed item"), cell(row, 1, "General"), cell(row, 2), cell(row, 3, "0"), cell(row, 4, "KSh 0"), formatKsh((Number(cell(row, 3, "0")) || 0) * parseAmount(cell(row, 4, "0"))), stock, statusTone(stock)]; }, setInventoryRows); break;
        case "Accounting": imported("transactions", (row) => [cell(row, 0, dateLabel()), cell(row, 1), cell(row, 2, "Transaction"), cell(row, 3, "Expense"), formatKsh(parseAmount(cell(row, 4, "0"))), transactionSign(cell(row, 3, "Expense"))], setTransactionRows); break;
        default: toast.error("This page doesn't support CSV import."); return;
      }
    };
    window.addEventListener("4s-record-history", onHistory as EventListener); window.addEventListener("4s-csv-import", onCsvImport as EventListener); window.addEventListener("4s-open-profile", onOpenProfile);
    return () => { window.removeEventListener("4s-record-history", onHistory as EventListener); window.removeEventListener("4s-csv-import", onCsvImport as EventListener); window.removeEventListener("4s-open-profile", onOpenProfile); };
  }, []);

  // --- Pickers ------------------------------------------------------------------------------
  // De-duplicated: two records can share a name, and suggestion lists need unique entries.
  const unique = (values: string[]) => Array.from(new Set(values.map((value) => (value || "").trim()).filter(Boolean)));
  const clientNames = unique(clientRows.map((row) => row[0]));
  const projectNames = unique(projectRows.map((row) => row[0]));
  const invoiceNumbers = unique(invoiceRows.filter((row) => row[6] !== "void").map((row) => row[0]));
  const memberNames = unique(["Unassigned", ...(members.data || []).map((member) => member.name)]);
  const findClient = (name: string) => clientRows.find((row) => (row[0] || "").trim().toLowerCase() === (name || "").trim().toLowerCase());

  // --- Invoices -----------------------------------------------------------------------------
  const openInvoiceDraft = (prefill: Partial<InvoiceFields> = {}) => { setInvoicePrefill(prefill); setInvoiceFormOpen(true); };
  const clientContact = (name: string): Partial<InvoiceFields> => { const client = findClient(name); return client ? { clientName: client[0], contactPerson: client[1] || "", clientEmail: client[2] || "", clientPhone: client[3] || "" } : { clientName: name }; };
  const invoiceFromContract = (contract: ContractRecord) => { const f = contract.fields; const deposit = Math.min(100, Math.max(0, Number(f.depositPercent) || 0)); const amount = Math.round(((Number(f.totalCost) || 0) * (deposit || 100)) / 100); openInvoiceDraft({ clientName: contract.clientName, clientEmail: contract.clientEmail || "", clientPhone: contract.clientPhone || "", projectName: f.projectName, scope: [f.websiteType, f.pages && `Pages: ${f.pages}`].filter(Boolean).join(" · ").slice(0, 600), quotationRef: contract.title.slice(0, 120), milestone: deposit && deposit < 100 ? "Deposit" : "Final balance", paymentTerms: deposit && deposit < 100 ? `${deposit}% deposit, balance before launch` : "Payable in full", items: [{ description: deposit && deposit < 100 ? `${f.websiteType || "Website"} - ${f.projectName} (${deposit}% deposit)` : `${f.websiteType || "Website"} - ${f.projectName}`, quantity: 1, unitPrice: amount }] }); };
  const nextInvoiceNumber = () => nextInvoiceNumberQuery.data || nextInvoiceNumberFrom(invoiceRows.map((row) => row[0] || ""));
  const isoDay = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400000).toISOString().slice(0, 10);
  const createQuote = async (fields: InvoiceFields, meta?: { number: string; issueDate: string; dueDate: string }) => {
    if (!meta) return;
    try {
      const created = await createQuoteDoc.mutateAsync({ fields, validUntil: meta.dueDate });
      setQuoteFormOpen(false);
      utils.records.list.invalidate(); utils.quoteDocs.nextNumber.invalidate();
      toast.success(`Quotation ${created.number} created`);
      setViewingQuoteId(created.quoteId);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create the quotation"); }
  };
  const createInvoice = async (fields: InvoiceFields, meta?: { number: string; issueDate: string; dueDate: string }) => {
    if (!meta) return;
    try {
      const created = await createInvoiceDoc.mutateAsync({ fields, issueDate: meta.issueDate, dueDate: meta.dueDate });
      setInvoiceFormOpen(false);
      utils.invoiceDocs.summaries.invalidate(); utils.invoiceDocs.nextNumber.invalidate(); utils.invoiceDocs.defaults.invalidate(); utils.records.list.invalidate();
      toast.success(`Invoice ${created.number} created`);
      setViewingInvoiceId(created.invoiceId);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not create the invoice"); }
  };
  const paymentLabels = ["Payment number", "Client", "Invoice", "Date", "Amount", "Method", "Status"];
  const paymentOptions: FieldOptions = { 1: { values: clientNames }, 2: { values: invoiceNumbers }, 5: { values: paymentMethodOptions }, 6: { values: paymentStatusOptions, strict: true } };
  const nextPaymentNumber = () => nextSequenceNumber(`PAY-${year}-`, paymentRows.map((row) => row[0]));
  const recordPaymentFor = (target: InvoicePaymentTarget) => openEditor("new payment", paymentLabels, [nextPaymentNumber(), target.clientName, target.number, dateLabel(), formatKsh(target.balance), "M-Pesa", "Completed"], (next, id) => setPaymentRows((current) => [...current, withId([...next, statusTone(next[6])], id)]), { options: paymentOptions });
  // Same as deleting an agreement: confirm, then remove it everywhere (dashboard rows included).
  function deleteInvoice(id: string, number: string) {
    if (!window.confirm(`Permanently delete invoice ${number}? Its saved details and share link stop working. This cannot be undone.`)) return;
    setInvoiceRows((current) => current.filter((row) => getRecordId(row) !== id));
    removeRecords.mutate({ tableName: "invoices", ids: [id] }, { onSuccess: () => { toast.success(`Invoice ${number} deleted`); setViewingInvoiceId(null); utils.invoiceDocs.nextNumber.invalidate(); } });
  }

  // --- Leads -> clients ---------------------------------------------------------------------
  const convertLead = (index: number) => {
    const lead = leadRows[index];
    if (!lead) return;
    const clientName = lead[1] || lead[0];
    const existing = findClient(clientName);
    const clientId = existing ? getRecordId(existing) : createRecordId("clients");
    if (!existing) setClientRows((current) => [...current, [clientName, lead[1] ? lead[0] : "", lead[7] || "", lead[8] || "", "KSh 0", "Active", "active", `${recordMarker}${clientId}`]]);
    updateStoredRow(setLeadRows, index, [...lead.slice(0, 4), "Won", "accepted", ...lead.slice(6)]);
    recordActivity(lead[0], "leads", "Converted", existing ? `Marked Won and linked to existing client ${clientName}.` : `Marked Won and created client ${clientName}.`, getRecordId(lead));
    toast.success(existing ? `${lead[0]} marked Won (client ${clientName} already exists)` : `${clientName} added as a client`);
    setSelectedClientId(clientId); setQuery(""); setPage("Client Details");
  };

  // --- Editors per table --------------------------------------------------------------------
  const clientLabels = ["Client name", "Primary contact", "Email", "Phone", "Outstanding amount", "Status"];
  const clientExtras = { readOnly: [4], options: { 5: { values: clientStatusOptions, strict: true } } };
  const editClient = (index: number) => openEditor("client", clientLabels, clientRows[index].slice(0, 6), (next) => updateStoredRow(setClientRows, index, [...next, statusTone(next[5])]), clientExtras);
  const leadLabels = ["Lead name", "Company", "Email", "Phone", "Source", "Estimated value", "Status", "Assigned to"];
  const leadExtras = { options: { 4: { values: ["Website contact form", "Referral", "WhatsApp", "Instagram", "Facebook", "Google", "LinkedIn", "Walk-in"] }, 6: { values: leadStatusOptions, strict: true }, 7: { values: memberNames } } };
  const leadFromEditor = (n: EditableRow) => [n[0], n[1], n[4], formatKsh(parseAmount(n[5])), n[6], statusTone(n[6]), n[7] || "Unassigned", n[2], n[3]];
  const projectLabels = ["Project name", "Client", "Progress (%)", "Status", "Due date", "Value"];
  const projectExtras = { options: { 1: { values: clientNames }, 3: { values: projectStatusOptions, strict: true } } };
  const projectFromEditor = (n: EditableRow) => [n[0], n[1], String(Math.min(100, Math.max(0, Number((n[2] || "").replace("%", "")) || 0))), n[3], statusTone(n[3]), n[4], formatKsh(parseAmount(n[5]))];
  const quoteLabels = ["Quote number", "Client", "Project", "Value", "Status", "Valid until"];
  // The value comes from the quotation's line items (Open -> Edit details), so it isn't typed here.
  const quoteExtras = { readOnly: [3], options: { 1: { values: clientNames }, 2: { values: projectNames }, 4: { values: quoteStatusOptions, strict: true } } };
  const inventoryLabels = ["Item", "Category", "SKU", "Quantity", "Unit cost", "Stock value", "Status"];
  const inventoryFromEditor = (n: EditableRow) => { const qty = String(Math.max(0, Math.round(Number(n[3]) || 0))); const stock = inventoryStock(qty); return [n[0], n[1] || "General", n[2], qty, formatKsh(parseAmount(n[4])), formatKsh(Number(qty) * parseAmount(n[4])), stock, statusTone(stock)]; };
  const transactionLabels = ["Date", "Reference", "Description", "Type", "Amount"];
  const transactionExtras = { options: { 3: { values: transactionTypeOptions, strict: true } } };

  const alerts = useMemo(() => buildWorkspaceAlerts({ invoiceRows, leadRows, projectRows, quoteRows, inventoryRows, renewals: renewalList.data }), [invoiceRows, leadRows, projectRows, quoteRows, inventoryRows, renewalList.data]);
  const navigate = (next: PageKey) => { setPage(next); setQuery(""); };
  const openSearchResult = (target: PageKey, row: EditableRow, table: string) => { if (table === "clients") { setSelectedClientId(getRecordId(row)); setQuery(""); setPage("Client Details"); return; } setPage(target); };
  const selectedClient = selectedClientId ? clientRows.find((row) => getRecordId(row) === selectedClientId) ?? null : null;
  // Projects, quotes, invoices and payments link to a client by name, so warn about a duplicate.
  const newClient = () => openEditor("new client", clientLabels, ["", "", "", "", "KSh 0", "Active"], (next, id) => { if (findClient(next[0])) toast.warning(`A client named “${next[0].trim()}” already exists. Records link to clients by name, so give each client a distinct name.`); setClientRows((current) => [...current, withId([...next, statusTone(next[5])], id)]); }, clientExtras);

  const content = (() => { switch (page) {
    case "Dashboard": return <DashboardPage onNavigate={navigate} clientRows={clientRows} invoiceRows={invoiceRows} transactionRows={transactionRows} projectRows={projectRows} inventoryRows={inventoryRows} />;
    case "Clients": return <ClientsPage onView={(index) => { setSelectedClientId(getRecordId(clientRows[index])); setQuery(""); setPage("Client Details"); }} query={query} rows={clientRows} onEdit={editClient} onCreate={newClient} onDelete={(index) => deleteRecord("client", "clients", clientRows[index], index, setClientRows)} onBulkEdit={(indices, value) => bulkUpdateRows("clients", setClientRows, clientRows, indices, (row) => [...row.slice(0, 5), value, statusTone(value), ...row.slice(7)])} onBulkDelete={(indices) => bulkDeleteRecords("client", "clients", clientRows, indices, setClientRows)} />;
    case "Leads": return <LeadsPage query={query} rows={leadRows} onConvert={convertLead} onEdit={(index) => { const r = leadRows[index]; openEditor("lead", leadLabels, [r[0], r[1], r[7] || "", r[8] || "", r[2], r[3], r[4], r[6] || "Unassigned"], (next) => updateStoredRow(setLeadRows, index, leadFromEditor(next)), leadExtras); }} onCreate={() => openEditor("new lead", leadLabels, ["", "", "", "", "Referral", "KSh 0", "New", user?.name || "Unassigned"], (next, id) => setLeadRows((current) => [...current, withId(leadFromEditor(next), id)]), leadExtras)} onDelete={(index) => deleteRecord("lead", "leads", leadRows[index], index, setLeadRows)} onBulkEdit={(indices, value) => bulkUpdateRows("leads", setLeadRows, leadRows, indices, (row) => [...row.slice(0, 4), value, statusTone(value), ...row.slice(6)])} onBulkDelete={(indices) => bulkDeleteRecords("lead", "leads", leadRows, indices, setLeadRows)} />;
    case "Projects": return <ProjectsPage query={query} rows={projectRows} onOpen={(index) => setWorkProjectId(getRecordId(projectRows[index]))} onEdit={(index) => { const r = projectRows[index]; openEditor("project", projectLabels, [r[0], r[1], r[2], r[3], r[5], r[6]], (next) => updateStoredRow(setProjectRows, index, projectFromEditor(next)), projectExtras); }} onCreate={() => openEditor("new project", projectLabels, ["", "", "0", "Planning", dateLabel(30), "KSh 0"], (next, id) => setProjectRows((current) => [...current, withId(projectFromEditor(next), id)]), projectExtras)} onDelete={(index) => deleteRecord("project", "projects", projectRows[index], index, setProjectRows)} onBulkEdit={(indices, value) => bulkUpdateRows("projects", setProjectRows, projectRows, indices, (row) => [...row.slice(0, 3), value, statusTone(value), ...row.slice(5)])} onBulkDelete={(indices) => bulkDeleteRecords("project", "projects", projectRows, indices, setProjectRows)} />;
    case "Quotes": return <QuotesPage query={query} rows={quoteRows} onInvoice={(index) => setViewingQuoteId(getRecordId(quoteRows[index]))} onEdit={(index) => { const r = quoteRows[index]; openEditor("quote", quoteLabels, [...r.slice(0, 5), r[6]], (next) => updateStoredRow(setQuoteRows, index, [next[0], next[1], next[2], formatKsh(parseAmount(next[3])), next[4], statusTone(next[4]), next[5]]), quoteExtras); }} onCreate={() => setQuoteFormOpen(true)} onDelete={(index) => deleteRecord("quote", "quotes", quoteRows[index], index, setQuoteRows)} onBulkEdit={(indices, value) => bulkUpdateRows("quotes", setQuoteRows, quoteRows, indices, (row) => [...row.slice(0, 4), value, statusTone(value), ...row.slice(6)])} onBulkDelete={(indices) => bulkDeleteRecords("quote", "quotes", quoteRows, indices, setQuoteRows)} />;
    case "Invoices": return <InvoicesPage query={query} onCreate={() => openInvoiceDraft()} onView={setViewingInvoiceId} onDelete={deleteInvoice} />;
    case "Payments": return <PaymentsPage panel={<MpesaPanel openInvoices={invoiceRows.filter((row) => row[6] === "pending" || row[6] === "overdue").map((row) => ({ id: getRecordId(row), number: row[0], client: row[1], balance: row[7] || row[4] }))} />} query={query} rows={paymentRows} onEdit={(index) => openEditor("payment", paymentLabels, paymentRows[index].slice(0, 7), (next) => updateStoredRow(setPaymentRows, index, [...next.slice(0, 4), formatKsh(parseAmount(next[4])), next[5], next[6], statusTone(next[6])]), { options: paymentOptions })} onCreate={() => openEditor("new payment", paymentLabels, [nextPaymentNumber(), "", "", dateLabel(), "KSh 0", "M-Pesa", "Completed"], (next, id) => setPaymentRows((current) => [...current, withId([...next.slice(0, 4), formatKsh(parseAmount(next[4])), next[5], next[6], statusTone(next[6])], id)]), { options: paymentOptions })} onDelete={(index) => deleteRecord("payment", "payments", paymentRows[index], index, setPaymentRows)} onBulkEdit={(indices, value) => bulkUpdateRows("payments", setPaymentRows, paymentRows, indices, (row) => [...row.slice(0, 6), value, statusTone(value), ...row.slice(8)])} onBulkDelete={(indices) => bulkDeleteRecords("payment", "payments", paymentRows, indices, setPaymentRows)} />;
    case "Inventory": return <InventoryPage query={query} rows={inventoryRows} onEdit={(index) => openEditor("inventory item", inventoryLabels, inventoryRows[index].slice(0, 7), (next) => updateStoredRow(setInventoryRows, index, inventoryFromEditor(next)), { readOnly: [5, 6] })} onCreate={() => openEditor("new inventory item", inventoryLabels, ["", "Equipment", nextSequenceNumber("AST-", inventoryRows.map((row) => row[2])), "1", "KSh 0", "KSh 0", "Low Stock"], (next, id) => setInventoryRows((current) => [...current, withId(inventoryFromEditor(next), id)]), { readOnly: [5, 6] })} onDelete={(index) => deleteRecord("inventory item", "inventory", inventoryRows[index], index, setInventoryRows)} onBulkDelete={(indices) => bulkDeleteRecords("inventory item", "inventory", inventoryRows, indices, setInventoryRows)} />;
    case "Accounting": return <AccountingBulkPage query={query} rows={transactionRows} onEdit={(index) => openEditor("transaction", transactionLabels, transactionRows[index].slice(0, 5), (next) => updateStoredRow(setTransactionRows, index, [...next.slice(0, 4), formatKsh(parseAmount(next[4])), transactionSign(next[3])]), transactionExtras)} onCreate={() => openEditor("new transaction", transactionLabels, [dateLabel(), "", "", "Expense", "KSh 0"], (next, id) => setTransactionRows((current) => [...current, withId([...next.slice(0, 4), formatKsh(parseAmount(next[4])), transactionSign(next[3])], id)]), transactionExtras)} onDelete={(index) => deleteRecord("transaction", "transactions", transactionRows[index], index, setTransactionRows)} onBulkEdit={(indices, value) => bulkUpdateRows("transactions", setTransactionRows, transactionRows, indices, (row) => [...row.slice(0, 3), value, row[4], transactionSign(value), ...row.slice(6)])} onBulkDelete={(indices) => bulkDeleteRecords("transaction", "transactions", transactionRows, indices, setTransactionRows)} />;
    case "Contracts": return <ContractsPage query={query} onCreateInvoice={invoiceFromContract} />;
    case "Renewals": return <RenewalsPage query={query} clients={clientNames} onOpenInvoice={setViewingInvoiceId} />;
    case "Reports": return <ReportsPage invoiceRows={invoiceRows} transactionRows={transactionRows} projectRows={projectRows} leadRows={leadRows} clientRows={clientRows} paymentRows={paymentRows} />;
    case "AI Assistant": return <AssistantPage invoices={invoiceRows} inventory={inventoryRows} projects={projectRows} transactions={transactionRows} />;
    case "Settings": return <><SettingsWorkspace /><RoleManagementPanel /><AccountLifecyclePanel openRequest={profileRequest} /></>;
    case "Client Details": return <ClientDetails client={selectedClient} projectRows={projectRows} invoiceRows={invoiceRows} paymentRows={paymentRows} onBack={() => setPage("Clients")} onEdit={() => { const index = selectedClient ? clientRows.indexOf(selectedClient) : -1; if (index >= 0) editClient(index); }} onNewInvoice={() => selectedClient && openInvoiceDraft(clientContact(selectedClient[0]))} onOpenInvoice={(id) => id && setViewingInvoiceId(id)} vault={selectedClient && getRecordId(selectedClient) ? <ClientVault key={getRecordId(selectedClient)} clientId={getRecordId(selectedClient)} clientName={selectedClient[0]} email={selectedClient[2] || ""} phone={selectedClient[3] || ""} /> : null} />;
    default: return <PlaceholderPage page={page} />;
  } })();
  const syncLabel = !user ? "Local draft - sign in to sync" : syncing > 0 ? "Saving changes…" : syncError ? "Changes not saved" : sharedRecords.isLoading ? "Loading workspace…" : "All changes saved";
  return <main className="dashboard-app"><Sidebar active={page} onNavigate={navigate} onQuickCreate={() => { navigate("Clients"); newClient(); }} /><section className="workspace"><Topbar query={query} onQuery={setQuery} onNavigate={navigate} alerts={alerts} /><div className={`sync-state ${syncError ? "is-error" : ""}`} role="status">{syncLabel}</div>{syncError ? <div className="panel sync-conflict" role="alert"><strong>We couldn’t save your latest changes.</strong><span>{syncError}</span><button onClick={() => { setSyncError(null); setSyncRetry((count) => count + 1); }}>Retry saving</button><button onClick={() => { void discardLocalChanges(); }}>Discard my changes</button></div> : null}{sharedRecords.isError && sharedRecords.error.data?.code !== "UNAUTHORIZED" ? <div className="panel sync-conflict" role="alert"><strong>Workspace data couldn’t be loaded.</strong><span>{sharedRecords.error.message}</span><button onClick={() => { void sharedRecords.refetch(); }}>Try again</button></div> : null}{query.trim() && !pagesWithTables.has(page) ? <GlobalSearchResults query={query} tables={{ clients: clientRows, leads: leadRows, projects: projectRows, quotes: quoteRows, invoices: invoiceRows, payments: paymentRows, inventory: inventoryRows, transactions: transactionRows }} onOpen={openSearchResult} /> : null}{content}{page === "Dashboard" ? <WorkspaceActivityTimeline /> : null}</section><RecordEditor editor={editor} onClose={() => setEditor(null)} />
    <InvoiceDetailsDialog kind="quote" rates={rates} open={quoteFormOpen} number="New quotation" initial={{ ...defaultInvoiceFields, ...(invoiceDefaults.data || {}) }} initialMeta={{ number: nextQuoteNumberQuery.data || nextSequenceNumber(`QT-${year}-`, quoteRows.map((row) => row[0])), issueDate: isoDay(), dueDate: isoDay(14) }} clients={clientRows.map((row) => ({ name: row[0], email: row[2] || "", phone: row[3] || "" }))} saving={createQuoteDoc.isPending} onClose={() => setQuoteFormOpen(false)} onSubmit={createQuote} />
    <QuoteViewDialog quoteId={viewingQuoteId} rates={rates} onClose={() => setViewingQuoteId(null)} onConvert={(fields) => { setViewingQuoteId(null); openInvoiceDraft(fields); }} />
    <ProjectWorkspace projectId={workProjectId} onClose={() => setWorkProjectId(null)} onOpenInvoice={(id) => { setWorkProjectId(null); setViewingInvoiceId(id); }} />
    <InvoiceDetailsDialog rates={rates} open={invoiceFormOpen} number="New invoice" initial={{ ...defaultInvoiceFields, ...(invoiceDefaults.data || {}), ...invoicePrefill }} initialMeta={{ number: nextInvoiceNumber(), issueDate: isoDay(), dueDate: isoDay(14) }} clients={clientRows.map((row) => ({ name: row[0], email: row[2] || "", phone: row[3] || "" }))} saving={createInvoiceDoc.isPending} onClose={() => setInvoiceFormOpen(false)} onSubmit={createInvoice} />
    <InvoiceViewDialog rates={rates} invoiceId={viewingInvoiceId} onClose={() => setViewingInvoiceId(null)} onRecordPayment={recordPaymentFor} onTotalChange={() => utils.records.list.invalidate()} onDelete={deleteInvoice} /><ActivityHistoryDialog target={historyTarget} events={activityEvents} onClose={() => setHistoryTarget(null)} /><RecoveryTray records={deletedRecords} onUndo={restoreRecord} onDismiss={(id) => setDeletedRecords((current) => current.filter((record) => record.id !== id))} /></main>;
}
