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
import GlobalQueryFeedback from "./components/GlobalQueryFeedback";

function App() {
  const path = window.location.pathname;
  const isLogin = path === "/login";
  const isContractSign = path.startsWith("/contracts/sign/");
  const isInvoiceView = path.startsWith("/invoices/view/");
  const isInvite = path.startsWith("/invite/");
  // Login, invitations and the public contract / invoice pages don't need an authenticated session,
  // so they skip AuthProvider entirely - no point fetching /api/auth/me for a visitor who isn't signed in.
  const page = isContractSign ? <ContractSign /> : isInvoiceView ? <InvoiceView /> : isInvite ? <InviteAccept /> : isLogin ? <Login /> : <AuthProvider><Home /></AuthProvider>;
  return <ErrorBoundary><ThemeProvider defaultTheme="dark"><TooltipProvider><Toaster theme="dark" richColors position="top-right"/><GlobalQueryFeedback/>{page}</TooltipProvider></ThemeProvider></ErrorBoundary>;
}
export default App;
