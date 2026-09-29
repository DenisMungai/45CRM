import { describe, expect, it } from "vitest";
import { buildProfileUpdateInput, formatLastSignedIn, shouldShowProfileSkeleton } from "./DashboardProfileCard";
import { buildIssueReportHref } from "./ErrorBoundary";
import { profileMutationFeedback } from "./DashboardProfileCard";
import { shouldShowQueryFeedback } from "./GlobalQueryFeedback";

describe("dashboard feedback view helpers", () => {
  it("shows global feedback only while one or more queries are fetching", () => {
    expect(shouldShowQueryFeedback(0)).toBe(false);
    expect(shouldShowQueryFeedback(1)).toBe(true);
    expect(shouldShowQueryFeedback(4)).toBe(true);
  });

  it("normalizes the profile editor payload before submission", () => {
    expect(buildProfileUpdateInput("  Denis Mungai  ", "  Creative operations lead  ")).toEqual({ name: "Denis Mungai", bio: "Creative operations lead" });
  });

  it("returns immediate success and error feedback copy for profile mutations", () => {
    expect(profileMutationFeedback("success")).toBe("Profile updated");
    expect(profileMutationFeedback("error")).toContain("Unable to update");
  });

  it("shows the profile skeleton only for an authenticated loading profile", () => {
    expect(shouldShowProfileSkeleton(true, true)).toBe(true);
    expect(shouldShowProfileSkeleton(false, true)).toBe(false);
    expect(shouldShowProfileSkeleton(true, false)).toBe(false);
  });

  it("builds a support report link with encoded error details", () => {
    const href = buildIssueReportHref("Request failed", "stack line 1");
    expect(href).toContain("mailto:support@4screatives.co.ke");
    expect(decodeURIComponent(href)).toContain("Request failed");
    expect(decodeURIComponent(href)).toContain("stack line 1");
  });

  it("formats valid profile timestamps and handles missing or invalid values", () => {
    expect(formatLastSignedIn(null)).toBe("Not available");
    expect(formatLastSignedIn("not-a-date")).toBe("Not available");
    expect(formatLastSignedIn("2026-08-26T13:23:00.000Z")).not.toBe("Not available");
  });
});
