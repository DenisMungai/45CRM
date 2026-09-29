import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

export function buildIssueReportHref(message?: string, stack?: string) {
  const subject = encodeURIComponent("4S Creatives dashboard issue");
  const body = encodeURIComponent(`${message || "Unexpected dashboard error"}\n\n${stack || "No stack trace available"}`);
  return `mailto:support@4screatives.co.ke?subject=${subject}&body=${body}`;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">We couldn’t load this workspace.</h2>
            <p className="mb-5 max-w-lg text-center text-sm text-muted-foreground">
              The dashboard hit an unexpected problem while loading data. Retry the page, or expand the details if support needs the technical context.
            </p>
            <details className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <summary className="cursor-pointer text-sm text-muted-foreground">Technical details</summary>
              <pre className="mt-3 text-xs text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack || this.state.error?.message}
              </pre>
            </details>

            <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              )}
            >
              <RotateCcw size={16} />
              Reload Page
            </button>
            <button
              onClick={() => {
                window.location.href = buildIssueReportHref(this.state.error?.message, this.state.error?.stack);
              }}
              className={cn("flex items-center gap-2 px-4 py-2 rounded-lg border border-border", "text-foreground hover:bg-muted cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring")}
            >
              Report Issue
            </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
