import { useIsFetching } from "@tanstack/react-query";
import { LoaderCircle } from "lucide-react";

export function shouldShowQueryFeedback(fetchingCount: number) {
  return fetchingCount > 0;
}

export default function GlobalQueryFeedback() {
  // Only counts queries fetching for the first time (never yet succeeded). Background
  // refetches of already-loaded data - window refocus, reconnect, periodic polling like the
  // activity feed's 10s interval - are silent, so this banner doesn't flash every few seconds.
  const fetchingCount = useIsFetching({ predicate: (query) => query.state.fetchStatus === "fetching" && query.state.status === "pending" });
  if (!shouldShowQueryFeedback(fetchingCount)) return null;

  return (
    <div className="global-query-status" role="status" aria-live="polite" aria-label="Loading workspace data">
      <LoaderCircle className="global-query-spinner" aria-hidden="true" />
      <span>Refreshing workspace data…</span>
    </div>
  );
}
