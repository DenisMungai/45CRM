/** Recurring services billed to clients (hosting, domains, maintenance retainers...). */

export const RENEWAL_TYPES = ["hosting", "domain", "maintenance", "ssl", "email", "other"] as const;
export type RenewalType = (typeof RENEWAL_TYPES)[number];
export const RENEWAL_TYPE_LABELS: Record<RenewalType, string> = { hosting: "Hosting", domain: "Domain", maintenance: "Maintenance", ssl: "SSL certificate", email: "Email", other: "Other" };

export const RENEWAL_CYCLES = ["monthly", "quarterly", "yearly"] as const;
export type RenewalCycle = (typeof RENEWAL_CYCLES)[number];
export const RENEWAL_CYCLE_LABELS: Record<RenewalCycle, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly" };
const cycleMonths: Record<RenewalCycle, number> = { monthly: 1, quarterly: 3, yearly: 12 };

export const RENEWAL_STATUSES = ["active", "cancelled"] as const;
export type RenewalStatus = (typeof RENEWAL_STATUSES)[number];

/** How far ahead a renewal counts as "due soon". */
export const RENEWAL_NOTICE_DAYS = 30;

export function isRenewalCycle(value: string): value is RenewalCycle { return (RENEWAL_CYCLES as readonly string[]).includes(value); }

/**
 * The same calendar day one cycle later. A day that doesn't exist in the target month is clamped
 * to its last day (31 Jan + 1 month = 28/29 Feb), so a renewal never skips a month.
 */
export function advanceDueDate(from: Date, cycle: RenewalCycle): Date {
  const months = cycleMonths[cycle];
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(from.getUTCDate(), lastDay), from.getUTCHours(), from.getUTCMinutes()));
}

/** A per-cycle amount expressed per year, for recurring-revenue totals. */
export function annualAmount(amount: number, cycle: RenewalCycle): number {
  return Math.round((Number(amount) || 0) * (12 / cycleMonths[cycle]));
}

/** Whole days from today (Nairobi calendar day) until the due date; negative when overdue. */
export function daysUntil(due: Date | string, now: Date = new Date()): number {
  const day = (value: Date) => { const [y, m, d] = value.toLocaleDateString("en-CA", { timeZone: "Africa/Nairobi" }).split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((day(new Date(due)) - day(now)) / 86_400_000);
}

export type RenewalUrgency = "cancelled" | "overdue" | "due-soon" | "scheduled";
export function renewalUrgency(input: { status: string; nextDueDate: Date | string }, now: Date = new Date()): RenewalUrgency {
  if (input.status === "cancelled") return "cancelled";
  const days = daysUntil(input.nextDueDate, now);
  if (days < 0) return "overdue";
  if (days <= RENEWAL_NOTICE_DAYS) return "due-soon";
  return "scheduled";
}

/** "17 Oct 2026 - 16 Oct 2027": the service period one invoice covers. */
export function renewalPeriodLabel(start: Date, cycle: RenewalCycle): string {
  const end = new Date(advanceDueDate(start, cycle).getTime() - 86_400_000);
  const fmt = (value: Date) => value.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
  return `${fmt(start)} - ${fmt(end)}`;
}
