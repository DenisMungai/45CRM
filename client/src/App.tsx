import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./_core/hooks/useAuth";
import Home from "./pages/Home";
import Login from "./pages/Login";
import ContractSign from "./pages/ContractSign";
import InvoiceView from "./pages/InvoiceView";
import InviteAccept from "./pages/InviteAccept";
import QuoteView from "./pages/QuoteView";
import Portal from "./pages/Portal";
import GlobalQueryFeedback from "./components/GlobalQueryFeedback";

function App() {
  const path = window.location.pathname;
  const isLogin = path === "/login";
  const isContractSign = path.startsWith("/contracts/sign/");
  const isInvoiceView = path.startsWith("/invoices/view/");
  const isInvite = path.startsWith("/invite/");
  const isQuoteView = path.startsWith("/quotes/view/");
  const isPortal = path.startsWith("/portal/");
  // Login, invitations, the client portal and the public contract / invoice / quote pages don't need
  // an authenticated session, so they skip AuthProvider entirely.
  const page = isContractSign ? <ContractSign /> : isInvoiceView ? <InvoiceView /> : isQuoteView ? <QuoteView /> : isPortal ? <Portal /> : isInvite ? <InviteAccept /> : isLogin ? <Login /> : <AuthProvider><Home /></AuthProvider>;
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><TooltipProvider><Toaster theme="dark" richColors position="top-right"/><GlobalQueryFeedback/>{page}</TooltipProvider></ThemeProvider></ErrorBoundary>;
}
export default App;
