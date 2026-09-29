import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import SignaturePad from "@/components/SignaturePad";
import { toast } from "sonner";
import { CheckCircle2, FileDown, FileSignature, ShieldCheck, Sparkles, TriangleAlert } from "lucide-react";

function tokenFromPath() {
  const match = window.location.pathname.match(/\/contracts\/sign\/([^/]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

function downloadBase64Pdf(filename: string, base64: string) {
  const bytes = atob(base64);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  const blob = new Blob([buffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export default function ContractSign() {
  const token = useMemo(() => tokenFromPath(), []);
  const utils = trpc.useUtils();
  const query = trpc.contracts.getByToken.useQuery({ token }, { enabled: Boolean(token), retry: false });
  const [signatureName, setSignatureName] = useState("");
  const [signatureImage, setSignatureImage] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const sign = trpc.contracts.signAsClient.useMutation({
    onSuccess: () => { toast.success("Agreement signed. A copy has been emailed to you."); utils.contracts.getByToken.invalidate({ token }); },
    onError: (error) => toast.error(error.message),
  });

  const downloadPdf = async () => {
    setDownloading(true);
    try {
      const pdf = await utils.client.contracts.downloadPdfByToken.query({ token });
      downloadBase64Pdf(pdf.filename, pdf.content);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare the PDF.");
    } finally {
      setDownloading(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <main className="sign-page">
      <div className="sign-shell">
        <div className="sign-brand"><Sparkles /><span>45Creatives</span></div>
        {children}
      </div>
    </main>
  );

  if (!token) return shell(<div className="sign-state"><TriangleAlert size={28} /><h1>Signing link missing</h1><p>This page needs a signing link token. Please use the link from your email or WhatsApp message.</p></div>);

  if (query.isLoading) return shell(<div className="sign-state"><div className="sign-spinner" /><p>Loading your agreement…</p></div>);

  if (query.isError) return shell(<div className="sign-state"><TriangleAlert size={28} /><h1>Link unavailable</h1><p>{query.error.message}</p></div>);

  const contract = query.data!;
  const alreadySigned = contract.status === "signed";

  if (alreadySigned || sign.isSuccess) {
    return shell(<div className="sign-state sign-success">
      <CheckCircle2 size={32} color="#78bd8e" />
      <h1>Agreement signed</h1>
      <p>{contract.clientName}, this agreement with {contract.providerName} has been signed{contract.clientSignedAt ? ` on ${new Date(contract.clientSignedAt).toLocaleString()}` : ""}. A copy has been emailed to both parties for your records.</p>
      <button className="primary" disabled={downloading} onClick={downloadPdf}><FileDown />{downloading ? "Preparing…" : "Download PDF copy"}</button>
      <div className="contract-document" dangerouslySetInnerHTML={{ __html: contract.documentHtml }} />
    </div>);
  }

  return shell(<div className="sign-panel">
    <div className="sign-head">
      <FileSignature />
      <div><span className="eyebrow">Web design & development agreement</span><h1>{contract.title}</h1><p>From {contract.providerName} to {contract.clientName}</p></div>
    </div>
    <div className="contract-document" dangerouslySetInnerHTML={{ __html: contract.documentHtml }} />
    <div className="sign-form panel">
      <h2>Sign this agreement</h2>
      <label>Full legal name<input value={signatureName} onChange={(e) => setSignatureName(e.target.value)} placeholder="Type your full name" /></label>
      <span className="panel-subtle">Optionally draw your signature below.</span>
      <SignaturePad onChange={setSignatureImage} />
      <label className="sign-agree"><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /><span>I, {signatureName.trim() || "the undersigned"}, have read and agree to the terms of this agreement. I understand this constitutes a legally binding electronic signature.</span></label>
      <button
        className="primary"
        disabled={!agreed || !signatureName.trim() || sign.isPending}
        onClick={() => sign.mutate({ token, signatureName: signatureName.trim(), signatureImageUrl: signatureImage })}
      >
        <ShieldCheck />{sign.isPending ? "Signing…" : "Sign agreement"}
      </button>
    </div>
  </div>);
}
