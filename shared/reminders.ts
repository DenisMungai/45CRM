/**
 * Which payment reminder an unpaid invoice is due for, from days until its due date (negative
 * when overdue). Each stage is a window rather than a single day, so a day the job didn't run is
 * caught up the next day; the server records each stage once so nothing is sent twice.
 *
 * - "before-due":  1-3 days before the due date
 * - "due":         on the due date (or up to 2 days after, if missed)
 * - "overdue-1":   7-13 days overdue
 * - "overdue-N":   every 14 days after that (21+, 35+, ...)
 */
export function reminderStage(daysUntilDue: number): string | null {
  const d = Math.round(daysUntilDue);
  if (d >= 1 && d <= 3) return "before-due";
  if (d <= 0 && d >= -2) return "due";
  if (d <= -7 && d >= -13) return "overdue-1";
  if (d <= -21) return `overdue-${2 + Math.floor((-d - 21) / 14)}`;
  return null;
}

export function reminderStageLabel(stage: string): string {
  if (stage === "before-due") return "Due soon";
  if (stage === "due") return "Due today";
  if (stage.startsWith("overdue-")) return `Overdue reminder ${stage.slice(8)}`;
  if (stage.startsWith("manual")) return "Manual reminder";
  return stage;
}
