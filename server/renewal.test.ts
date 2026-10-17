import { describe, expect, it } from "vitest";
import { advanceDueDate, annualAmount, daysUntil, renewalPeriodLabel, renewalUrgency } from "../shared/renewal";

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("renewal dates", () => {
  it("moves on by one cycle, keeping the calendar day", () => {
    expect(advanceDueDate(utc("2026-10-17"), "monthly").toISOString().slice(0, 10)).toBe("2026-11-17");
    expect(advanceDueDate(utc("2026-10-17"), "quarterly").toISOString().slice(0, 10)).toBe("2027-01-17");
    expect(advanceDueDate(utc("2026-10-17"), "yearly").toISOString().slice(0, 10)).toBe("2027-10-17");
  });
  it("clamps to the end of shorter months instead of skipping one", () => {
    expect(advanceDueDate(utc("2027-01-31"), "monthly").toISOString().slice(0, 10)).toBe("2027-02-28");
    expect(advanceDueDate(utc("2028-01-31"), "monthly").toISOString().slice(0, 10)).toBe("2028-02-29");
    expect(advanceDueDate(utc("2028-02-29"), "yearly").toISOString().slice(0, 10)).toBe("2029-02-28");
  });
  it("labels the period an invoice covers", () => {
    expect(renewalPeriodLabel(utc("2026-10-17"), "yearly")).toBe("17 Oct 2026 - 16 Oct 2027");
  });
});

describe("renewal money and urgency", () => {
  it("annualises per-cycle prices", () => {
    expect(annualAmount(5000, "monthly")).toBe(60000);
    expect(annualAmount(9000, "quarterly")).toBe(36000);
    expect(annualAmount(12000, "yearly")).toBe(12000);
  });
  it("classifies renewals by how soon they are due (Nairobi calendar days)", () => {
    const now = new Date("2026-10-17T09:00:00Z");
    expect(daysUntil(utc("2026-10-17"), now)).toBe(0);
    expect(renewalUrgency({ status: "active", nextDueDate: utc("2026-10-10") }, now)).toBe("overdue");
    expect(renewalUrgency({ status: "active", nextDueDate: utc("2026-11-10") }, now)).toBe("due-soon");
    expect(renewalUrgency({ status: "active", nextDueDate: utc("2027-01-10") }, now)).toBe("scheduled");
    expect(renewalUrgency({ status: "cancelled", nextDueDate: utc("2026-10-10") }, now)).toBe("cancelled");
  });
});
