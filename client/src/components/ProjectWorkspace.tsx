import { useEffect, useState } from "react";
import { Check, CheckCircle2, Clock, Flag, GitPullRequest, Pencil, Plus, ReceiptText, Send, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Tab = "milestones" | "changes" | "time";
type MilestoneStatus = "pending" | "in-progress" | "awaiting-approval" | "approved" | "changes-requested";
type ChangeStatus = "requested" | "approved" | "declined" | "done";

const ksh = (value: number) => `KSh ${Math.round(value).toLocaleString("en-KE")}`;
const day = (value: Date | string | null | undefined) => value ? new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Nairobi" }) : "";
const isoDay = (value: Date | string | null | undefined) => value ? new Date(value).toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" }) : "";
const toDate = (value: string) => value ? new Date(`${value}T00:00:00Z`) : null;
const hours = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
const milestoneLabels: Record<MilestoneStatus, string> = { pending: "Not started", "in-progress": "In progress", "awaiting-approval": "Awaiting client approval", approved: "Approved", "changes-requested": "Changes requested" };
const milestoneTone: Record<MilestoneStatus, string> = { pending: "draft", "in-progress": "in-progress", "awaiting-approval": "pending", approved: "paid", "changes-requested": "overdue" };
const changeLabels: Record<ChangeStatus, string> = { requested: "Requested", approved: "Approved", declined: "Declined", done: "Done" };
const changeTone: Record<ChangeStatus, string> = { requested: "pending", approved: "sent", declined: "expired", done: "paid" };

type MilestoneForm = { id?: string; title: string; description: string; dueDate: string; amount: string; status: MilestoneStatus };
type ChangeForm = { id?: string; title: string; description: string; kind: "revision" | "change"; status: ChangeStatus; estimateHours: string; amount: string };

/** Delivery workspace for one project: milestones (with client approval), tasks, change requests and time. */
export default function ProjectWorkspace({ projectId, onClose, onOpenInvoice }: { projectId: string | null; onClose: () => void; onOpenInvoice: (invoiceId: string) => void }) {
  const utils = trpc.useUtils();
  const query = trpc.work.get.useQuery({ projectId: projectId || "" }, { enabled: Boolean(projectId), retry: false });
  const members = trpc.workspace.members.useQuery(undefined, { enabled: Boolean(projectId) });
  const [tab, setTab] = useState<Tab>("milestones");
  const [milestoneForm, setMilestoneForm] = useState<MilestoneForm | null>(null);
  const [changeForm, setChangeForm] = useState<ChangeForm | null>(null);
  const [taskTitle, setTaskTitle] = useState<Record<string, string>>({});
  const [time, setTime] = useState({ description: "", hours: "", minutes: "", date: isoDay(new Date()), billable: true, rate: "", changeRequestId: "" });
  useEffect(() => { setTab("milestones"); setMilestoneForm(null); setChangeForm(null); }, [projectId]);
  useEffect(() => { if (query.data && !time.rate) setTime((t) => ({ ...t, rate: query.data.defaultHourlyRate ? String(query.data.defaultHourlyRate) : "" })); }, [query.data?.defaultHourlyRate]);
  const refresh = () => { utils.work.get.invalidate(); utils.records.list.invalidate(); };
  const opts = (done: string) => ({ onSuccess: () => { toast.success(done); refresh(); }, onError: (error: { message: string }) => toast.error(error.message) });
  const saveMilestone = trpc.work.saveMilestone.useMutation({ onSuccess: () => { toast.success("Milestone saved"); setMilestoneForm(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const deleteMilestone = trpc.work.deleteMilestone.useMutation(opts("Milestone deleted"));
  const saveTask = trpc.work.saveTask.useMutation({ onSuccess: () => refresh(), onError: (error) => toast.error(error.message) });
  const deleteTask = trpc.work.deleteTask.useMutation({ onSuccess: () => refresh(), onError: (error) => toast.error(error.message) });
  const saveChange = trpc.work.saveChange.useMutation({ onSuccess: () => { toast.success("Change request saved"); setChangeForm(null); refresh(); }, onError: (error) => toast.error(error.message) });
  const deleteChange = trpc.work.deleteChange.useMutation(opts("Change request deleted"));
  const logTime = trpc.work.logTime.useMutation({ onSuccess: () => { toast.success("Time logged"); setTime((t) => ({ ...t, description: "", hours: "", minutes: "" })); refresh(); }, onError: (error) => toast.error(error.message) });
  const deleteTime = trpc.work.deleteTime.useMutation(opts("Time entry deleted"));
  const invoiced = (label: string) => ({ onSuccess: (result: { invoiceId: string; number: string }) => { toast.success(`Invoice ${result.number} drafted for ${label}. Review and send it.`); refresh(); utils.invoiceDocs.summaries.invalidate(); utils.invoiceDocs.nextNumber.invalidate(); onOpenInvoice(result.invoiceId); }, onError: (error: { message: string }) => toast.error(error.message) });
  const invoiceMilestone = trpc.work.invoiceMilestone.useMutation(invoiced("the milestone"));
  const invoiceChanges = trpc.work.invoiceChanges.useMutation(invoiced("change requests"));
  const invoiceTime = trpc.work.invoiceTime.useMutation(invoiced("time"));
  if (!projectId) return null;
  const data = query.data;
  const memberOptions = members.data || [];
  const setStatus = (m: NonNullable<typeof data>["milestones"][number], status: MilestoneStatus) => saveMilestone.mutate({ id: m.id, projectId, title: m.title, description: m.description, dueDate: m.dueDate ? new Date(m.dueDate) : null, amount: m.amount, status });
  const minutesEntered = (Number(time.hours) || 0) * 60 + (Number(time.minutes) || 0);
  const billableChanges = data?.changeRequests.filter((c) => !c.invoiceId && c.amount > 0 && (c.status === "approved" || c.status === "done")) || [];
  const looseTasks = data?.tasks.filter((t) => !t.milestoneId) || [];
  const taskList = (milestoneId: string | null) => {
    const tasks = (data?.tasks || []).filter((t) => (t.milestoneId || null) === milestoneId);
    const key = milestoneId || "none";
    return <div className="work-tasks">
      {tasks.map((task) => <div className={`work-task ${task.status === "done" ? "done" : ""}`} key={task.id}>
        <input type="checkbox" checked={task.status === "done"} aria-label={`Mark "${task.title}" ${task.status === "done" ? "not done" : "done"}`} onChange={() => saveTask.mutate({ id: task.id, projectId, milestoneId: task.milestoneId, title: task.title, assigneeUserId: task.assigneeUserId, dueDate: task.dueDate ? new Date(task.dueDate) : null, done: task.status !== "done", priority: (task.priority as "low" | "normal" | "high") || "normal" })} />
        <span>{task.title}</span>
        <select value={task.assigneeUserId || ""} aria-label="Assign task" onChange={(e) => saveTask.mutate({ id: task.id, projectId, milestoneId: task.milestoneId, title: task.title, assigneeUserId: e.target.value || null, dueDate: task.dueDate ? new Date(task.dueDate) : null, done: task.status === "done", priority: (task.priority as "low" | "normal" | "high") || "normal" })}><option value="">Unassigned</option>{memberOptions.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        <button className="icon-button" aria-label={`Delete task "${task.title}"`} onClick={() => deleteTask.mutate({ id: task.id })}><Trash2 /></button>
      </div>)}
      <form className="work-task-add" onSubmit={(e) => { e.preventDefault(); const title = (taskTitle[key] || "").trim(); if (!title) return; saveTask.mutate({ projectId, milestoneId, title, done: false, priority: "normal" }); setTaskTitle((c) => ({ ...c, [key]: "" })); }}>
        <input value={taskTitle[key] || ""} onChange={(e) => setTaskTitle((c) => ({ ...c, [key]: e.target.value }))} placeholder="Add a task…" aria-label="New task" maxLength={220} />
        <button className="text-button" disabled={!(taskTitle[key] || "").trim()}><Plus size={11} />Add</button>
      </form>
    </div>;
  };
  return <div className="record-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="record-dialog panel contract-view-dialog work-dialog" role="dialog" aria-modal="true" aria-labelledby="work-title" onMouseDown={(e) => e.stopPropagation()}>
      <div className="record-dialog-head"><div><span className="eyebrow">{data?.client?.name || "Project"}</span><h2 id="work-title">{data?.project.name || "Loading…"}</h2></div><button className="record-close" aria-label="Close" onClick={onClose}><X /></button></div>
      {query.isLoading ? <p className="activity-empty">Loading project…</p> : query.isError || !data ? <div className="contract-link-box"><span>{query.error?.message || "Project not found."}</span><button className="text-button" onClick={() => query.refetch()}>Try again</button></div> : <>
        <div className="work-summary">
          <div><span>Progress</span><strong>{data.project.progress}%</strong><small>{data.milestones.length ? `${data.milestones.filter((m) => m.status === "approved").length} of ${data.milestones.length} milestones approved` : "Add milestones to track progress"}</small></div>
          <div><span>Agreement</span><strong>{data.contract ? data.contract.status : "None"}</strong><small>{data.contract ? `${data.contract.revisionRounds} revision round${data.contract.revisionRounds === 1 ? "" : "s"} included${data.contract.extraRevisionCost ? `, then ${ksh(data.contract.extraRevisionCost)} each` : ""}` : "Link an agreement to this project to track revisions"}</small></div>
          <div><span>Time logged</span><strong>{hours(data.totals.minutes)}</strong><small>{data.totals.unbilledAmount ? `${ksh(data.totals.unbilledAmount)} unbilled` : "Nothing unbilled"}</small></div>
          <div><span>Open changes</span><strong>{data.changeRequests.filter((c) => c.status === "requested").length}</strong><small>{billableChanges.length ? `${billableChanges.length} ready to invoice` : "Nothing to bill"}</small></div>
        </div>
        {!data.client ? <p className="panel-subtle work-warning">This project isn't linked to a client, so it can't be invoiced or shown in a client portal. Set its client under Projects → Edit.</p> : null}
        <div className="work-tabs" role="tablist">{([["milestones", "Milestones & tasks", Flag], ["changes", "Changes", GitPullRequest], ["time", "Time", Clock]] as const).map(([key, label, Icon]) => <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? "active" : ""} onClick={() => setTab(key)}><Icon />{label}</button>)}</div>

        {tab === "milestones" ? <div className="work-panel">
          <div className="work-panel-head"><p className="panel-subtle">Mark a milestone “Awaiting client approval” and the client can approve it, or ask for changes, in their portal.</p><button className="record-edit" onClick={() => setMilestoneForm({ title: "", description: "", dueDate: "", amount: "", status: "pending" })}><Plus />Add milestone</button></div>
          {data.milestones.length === 0 ? <p className="activity-empty">No milestones yet. Typical stages: Design mockups → Development → Content & review → Launch.</p> : data.milestones.map((m) => { const status = m.status as MilestoneStatus; return <article className="work-milestone" key={m.id}>
            <header>
              <div><strong>{m.title}</strong><span className={`status ${milestoneTone[status] || "draft"}`}>{milestoneLabels[status] || m.status}</span>{m.dueDate ? <small>Due {day(m.dueDate)}</small> : null}{m.amount ? <small>{ksh(m.amount)}</small> : null}</div>
              <div className="record-actions">
                {status !== "approved" && status !== "awaiting-approval" ? <button className="record-edit" disabled={!data.client} title={data.client ? "Ask the client to approve this in their portal" : "Link the project to a client first"} onClick={() => setStatus(m, "awaiting-approval")}><Send />Request approval</button> : null}
                {status === "awaiting-approval" ? <button className="record-edit" title="Mark approved without waiting for the portal" onClick={() => setStatus(m, "approved")}><CheckCircle2 />Mark approved</button> : null}
                {m.amount > 0 && !m.invoiceId ? <button className="record-edit" disabled={invoiceMilestone.isPending || !data.client} onClick={() => invoiceMilestone.mutate({ id: m.id })}><ReceiptText />Invoice</button> : null}
                {m.invoiceId ? <button className="record-edit" onClick={() => onOpenInvoice(m.invoiceId!)}><ReceiptText />View invoice</button> : null}
                <button className="record-edit" onClick={() => setMilestoneForm({ id: m.id, title: m.title, description: m.description || "", dueDate: isoDay(m.dueDate), amount: m.amount ? String(m.amount) : "", status })}><Pencil />Edit</button>
                <button className="record-delete" onClick={() => { if (window.confirm(`Delete milestone "${m.title}"? Its tasks stay on the project.`)) deleteMilestone.mutate({ id: m.id }); }}><Trash2 /></button>
              </div>
            </header>
            {m.description ? <p className="work-desc">{m.description}</p> : null}
            {m.decidedByName ? <p className="work-decision">{status === "approved" ? "Approved" : "Changes requested"} by {m.decidedByName} on {day(m.decidedAt)}{m.clientNote ? `: “${m.clientNote}”` : ""}</p> : null}
            {taskList(m.id)}
          </article>; })}
          <article className="work-milestone"><header><div><strong>Other tasks</strong><small>{looseTasks.length} task{looseTasks.length === 1 ? "" : "s"}</small></div></header>{taskList(null)}</article>
        </div> : null}

        {tab === "changes" ? <div className="work-panel">
          <div className="work-panel-head"><p className="panel-subtle">Revisions count against the agreement's included rounds; extra rounds are priced at its extra-revision rate automatically. Clients can raise requests from their portal.</p><div className="record-actions"><button className="record-edit" disabled={!billableChanges.length || invoiceChanges.isPending || !data.client} onClick={() => invoiceChanges.mutate({ projectId })}><ReceiptText />Invoice {billableChanges.length || ""} approved</button><button className="record-edit" onClick={() => setChangeForm({ title: "", description: "", kind: "revision", status: "requested", estimateHours: "", amount: "" })}><Plus />Add request</button></div></div>
          {data.changeRequests.length === 0 ? <p className="activity-empty">No change requests yet.</p> : <div className="table-scroller"><table className="data-table"><thead><tr><th>Request</th><th>Type</th><th>Status</th><th>Estimate</th><th>Price</th><th></th></tr></thead><tbody>{data.changeRequests.map((c) => <tr key={c.id}>
            <td className="strong-cell">{c.title}<small className="cell-sub">{c.source === "client" ? `From ${c.requestedByName || "the client"} via portal` : "Internal"} · {day(c.createdAt)}</small></td>
            <td>{c.kind === "revision" ? <>Revision {c.revisionNumber ?? ""}{c.overLimit ? <small className="cell-sub danger">Beyond included rounds</small> : c.revisionNumber ? <small className="cell-sub">Included</small> : null}</> : "Scope change"}</td>
            <td><span className={`status ${changeTone[c.status as ChangeStatus] || "draft"}`}>{changeLabels[c.status as ChangeStatus] || c.status}</span></td>
            <td>{c.estimateHours ? `${c.estimateHours} h` : "-"}</td>
            <td className="value-cell">{c.amount ? ksh(c.amount) : "-"}{c.invoiceId ? <small className="cell-sub">Invoiced</small> : null}</td>
            <td><div className="record-actions">{c.invoiceId ? <button className="record-edit" onClick={() => onOpenInvoice(c.invoiceId!)}><ReceiptText />Invoice</button> : null}<button className="record-edit" onClick={() => setChangeForm({ id: c.id, title: c.title, description: c.description || "", kind: c.kind === "revision" ? "revision" : "change", status: c.status as ChangeStatus, estimateHours: c.estimateHours ? String(c.estimateHours) : "", amount: c.amount ? String(c.amount) : "" })}><Pencil />Edit</button><button className="record-delete" disabled={Boolean(c.invoiceId)} onClick={() => { if (window.confirm(`Delete "${c.title}"?`)) deleteChange.mutate({ id: c.id }); }}><Trash2 /></button></div></td>
          </tr>)}</tbody></table></div>}
        </div> : null}

        {tab === "time" ? <div className="work-panel">
          <form className="work-time-form" onSubmit={(e) => { e.preventDefault(); logTime.mutate({ projectId, description: time.description.trim(), minutes: minutesEntered, workDate: toDate(time.date) || new Date(), billable: time.billable, hourlyRate: Math.max(0, Math.round(Number(time.rate) || 0)), changeRequestId: time.changeRequestId || null }); }}>
            <label className="wide">What did you work on?<input value={time.description} onChange={(e) => setTime({ ...time, description: e.target.value })} placeholder="Homepage layout, contact form fixes…" maxLength={300} /></label>
            <label>Hours<input type="number" min="0" max="24" value={time.hours} onChange={(e) => setTime({ ...time, hours: e.target.value })} /></label>
            <label>Minutes<input type="number" min="0" max="59" value={time.minutes} onChange={(e) => setTime({ ...time, minutes: e.target.value })} /></label>
            <label>Date<input type="date" value={time.date} onChange={(e) => setTime({ ...time, date: e.target.value })} /></label>
            <label>Rate (KSh/h)<input type="number" min="0" value={time.rate} onChange={(e) => setTime({ ...time, rate: e.target.value })} placeholder={data.defaultHourlyRate ? String(data.defaultHourlyRate) : "0"} /></label>
            <label>For change request<select value={time.changeRequestId} onChange={(e) => setTime({ ...time, changeRequestId: e.target.value })}><option value="">-</option>{data.changeRequests.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
            <label className="checkbox-field"><input type="checkbox" checked={time.billable} onChange={(e) => setTime({ ...time, billable: e.target.checked })} />Billable</label>
            <button className="record-save" disabled={logTime.isPending || !time.description.trim() || minutesEntered < 1}><Check />{logTime.isPending ? "Saving…" : "Log time"}</button>
          </form>
          <div className="work-panel-head"><p className="panel-subtle">{hours(data.totals.minutes)} logged · {hours(data.totals.unbilledMinutes)} billable not yet invoiced ({ksh(data.totals.unbilledAmount)})</p><button className="record-edit" disabled={!data.totals.unbilledAmount || invoiceTime.isPending || !data.client} onClick={() => invoiceTime.mutate({ projectId })}><ReceiptText />Invoice unbilled time</button></div>
          {data.timeEntries.length === 0 ? <p className="activity-empty">No time logged yet.</p> : <div className="table-scroller"><table className="data-table"><thead><tr><th>Date</th><th>Work</th><th>Who</th><th>Time</th><th>Value</th><th></th></tr></thead><tbody>{data.timeEntries.map((t) => <tr key={t.id}>
            <td>{day(t.workDate)}</td><td className="strong-cell">{t.description}{!t.billable ? <small className="cell-sub">Not billable</small> : t.invoiceId ? <small className="cell-sub">Invoiced</small> : null}</td><td>{t.userName || "-"}</td><td>{hours(t.minutes)}</td><td className="value-cell">{t.billable && t.hourlyRate ? ksh((t.minutes / 60) * t.hourlyRate) : "-"}</td>
            <td>{t.invoiceId ? <button className="record-edit" onClick={() => onOpenInvoice(t.invoiceId!)}><ReceiptText />Invoice</button> : <button className="record-delete" aria-label="Delete time entry" onClick={() => deleteTime.mutate({ id: t.id })}><Trash2 /></button>}</td>
          </tr>)}</tbody></table></div>}
        </div> : null}
      </>}

      {milestoneForm ? <div className="work-subdialog" role="dialog" aria-label="Milestone">
        <h3>{milestoneForm.id ? "Edit milestone" : "New milestone"}</h3>
        <div className="record-fields">
          <label className="wide">Title<input value={milestoneForm.title} onChange={(e) => setMilestoneForm({ ...milestoneForm, title: e.target.value })} placeholder="Design mockups" maxLength={200} /></label>
          <label className="wide">What's delivered<textarea rows={2} value={milestoneForm.description} onChange={(e) => setMilestoneForm({ ...milestoneForm, description: e.target.value })} placeholder="Shown to the client when you ask for approval" /></label>
          <label>Due date<input type="date" value={milestoneForm.dueDate} onChange={(e) => setMilestoneForm({ ...milestoneForm, dueDate: e.target.value })} /></label>
          <label>Amount to bill (KSh)<input type="number" min="0" value={milestoneForm.amount} onChange={(e) => setMilestoneForm({ ...milestoneForm, amount: e.target.value })} placeholder="0 if not billed separately" /></label>
          <label>Status<select value={milestoneForm.status} onChange={(e) => setMilestoneForm({ ...milestoneForm, status: e.target.value as MilestoneStatus })}>{(Object.keys(milestoneLabels) as MilestoneStatus[]).map((s) => <option key={s} value={s}>{milestoneLabels[s]}</option>)}</select></label>
        </div>
        <div className="record-dialog-actions"><button className="record-reset" onClick={() => setMilestoneForm(null)}>Cancel</button><button className="record-save" disabled={!milestoneForm.title.trim() || saveMilestone.isPending} onClick={() => saveMilestone.mutate({ id: milestoneForm.id, projectId, title: milestoneForm.title, description: milestoneForm.description || null, dueDate: toDate(milestoneForm.dueDate), amount: Math.max(0, Math.round(Number(milestoneForm.amount) || 0)), status: milestoneForm.status })}><Check />Save milestone</button></div>
      </div> : null}
      {changeForm ? <div className="work-subdialog" role="dialog" aria-label="Change request">
        <h3>{changeForm.id ? "Edit change request" : "New change request"}</h3>
        <div className="record-fields">
          <label className="wide">Request<input value={changeForm.title} onChange={(e) => setChangeForm({ ...changeForm, title: e.target.value })} placeholder="Add a blog section" maxLength={200} /></label>
          <label className="wide">Details<textarea rows={2} value={changeForm.description} onChange={(e) => setChangeForm({ ...changeForm, description: e.target.value })} /></label>
          <label>Type<select value={changeForm.kind} onChange={(e) => setChangeForm({ ...changeForm, kind: e.target.value as ChangeForm["kind"] })}><option value="revision">Revision round</option><option value="change">Scope change</option></select></label>
          <label>Status<select value={changeForm.status} onChange={(e) => setChangeForm({ ...changeForm, status: e.target.value as ChangeStatus })}>{(Object.keys(changeLabels) as ChangeStatus[]).map((s) => <option key={s} value={s}>{changeLabels[s]}</option>)}</select></label>
          <label>Estimate (hours)<input type="number" min="0" value={changeForm.estimateHours} onChange={(e) => setChangeForm({ ...changeForm, estimateHours: e.target.value })} /></label>
          <label>Price (KSh)<input type="number" min="0" value={changeForm.amount} onChange={(e) => setChangeForm({ ...changeForm, amount: e.target.value })} placeholder={changeForm.kind === "revision" ? "Auto for extra rounds" : "0"} /></label>
        </div>
        <div className="record-dialog-actions"><button className="record-reset" onClick={() => setChangeForm(null)}>Cancel</button><button className="record-save" disabled={!changeForm.title.trim() || saveChange.isPending} onClick={() => saveChange.mutate({ id: changeForm.id, projectId, title: changeForm.title, description: changeForm.description || null, kind: changeForm.kind, status: changeForm.status, estimateHours: Math.max(0, Math.round(Number(changeForm.estimateHours) || 0)), amount: Math.max(0, Math.round(Number(changeForm.amount) || 0)) })}><Check />Save request</button></div>
      </div> : null}
    </section>
  </div>;
}
