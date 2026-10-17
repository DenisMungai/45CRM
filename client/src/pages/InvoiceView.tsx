import { useMemo, useState } from "react";
import { FileDown, Printer, Sparkles, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { downloadBase64Pdf } from "@/lib/utils";
import InvoiceSheet from "@/components/InvoiceSheet";

export default function InvoiceView() {
  const token = useMemo(() => decodeURIComponent(window.location.pathname.match(/\/invoices\/view\/([^/]+)/)?.[1] || ""), []);
  const utils = trpc.useUtils();
  const query = trpc.invoiceDocs.getByToken.useQuery({ token }, { enabled: token.length >= 20, retry: false });
  const [busy, setBusy] = useState(false);
  const download = async () => {
    setBusy(true);
    try { const pdf = await utils.client.invoiceDocs.downloadPdfByToken.query({ token }); downloadBase64Pdf(pdf.content, pdf.filename); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not prepare the PDF."); }
    finally { setBusy(false); }
  };
  const shell = (children: React.ReactNode) => <main className="sign-page inv-public"><div className="sign-shell inv-shell"><div className="sign-brand"><Sparkles /><span>45Creatives</span></div>{children}</div></main>;
  if (token.length < 20) return shell(<div className="sign-state"><TriangleAlert size={28} /><h1>Invoice link missing</h1><p>Please use the link from your email or WhatsApp message.</p></div>);
  if (query.isLoading) return shell(<div className="sign-state"><div className="sign-spinner" /><p>Loading your invoice…</p></div>);
  if (query.isError) return shell(<div className="sign-state"><TriangleAlert size={28} /><h1>Link unavailable</h1><p>{query.error.message}</p></div>);
  return shell(<>
    <div className="inv-public-actions"><button className="primary" disabled={busy} onClick={download}><FileDown />{busy ? "Preparing…" : "Download PDF"}</button><button onClick={() => window.print()}><Printer />Print</button></div>
    <InvoiceSheet view={query.data!.view} />
  </>);
}
