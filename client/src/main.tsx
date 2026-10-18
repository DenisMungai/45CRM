import { trpc } from "@/lib/trpc";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import "./index.css";

// Query errors are handled where they happen (each page shows its own message, e.g. an expired
// invoice or signing link). Throwing them sent the whole app to the error screen instead. Only
// unexpected non-API failures still reach the error boundary.
// No refetch on window focus: pages copy query data into local state (record tables, settings
// forms), so a focus refetch reset everything on screen each time the user switched back to the
// tab. Data still refreshes after every mutation, which invalidates what it changed.
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, throwOnError: (error) => !(error instanceof TRPCClientError) } } });
const trpcClient = trpc.createClient({ links: [httpBatchLink({ url: "/api/trpc", transformer: superjson, fetch(input, init) { return fetch(input, { ...init, credentials: "include" }); } })] });
createRoot(document.getElementById("root")!).render(<trpc.Provider client={trpcClient} queryClient={queryClient}><QueryClientProvider client={queryClient}><App /></QueryClientProvider></trpc.Provider>);
