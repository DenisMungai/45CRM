import { useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { downloadBase64Pdf } from "@/lib/utils";

export type InvoiceSendResult = { channel: "email" | "whatsapp"; viewUrl: string; waLink: string | null; emailDraftUrl: string };

/** Save / send / download behaviour shared by the invoice popup and the full invoice page. */
export function useInvoiceActions({ invoiceId, hasDocument, onTotalChange }: { invoiceId: string; hasDocument: boolean; onTotalChange: (total: number) => void }) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [sending, setSending] = useState<"email" | "whatsapp" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sendResult, setSendResult] = useState<InvoiceSendResult | null>(null);
  const composeWindow = useRef<Window | null>(null);
  const refresh = () => { utils.invoiceDocs.view.invalidate(); utils.invoiceDocs.list.invalidate(); };
  const save = trpc.invoiceDocs.save.useMutation({
    onSuccess: (result) => { setEditing(false); onTotalChange(result.total); refresh(); toast.success("Invoice details saved"); },
    onError: (error) => toast.error(error.message),
  });
  const send = trpc.invoiceDocs.send.useMutation({
    onSuccess: (result) => {
      setSendResult(result);
      const url = result.channel === "whatsapp" ? result.waLink : result.emailDraftUrl;
      if (composeWindow.current && url) composeWindow.current.location.href = url;
      composeWindow.current = null;
      refresh();
      toast.success(result.channel === "whatsapp" ? "WhatsApp is ready. Review and send the message." : "Gmail draft is ready. Review and send the email.");
      setSending(null);
    },
    onError: (error) => { composeWindow.current?.close(); composeWindow.current = null; toast.error(error.message); setSending(null); },
  });
  const startSend = (channel: "email" | "whatsapp") => {
    if (!hasDocument) { setEditing(true); toast.info("Review and save the invoice details before sending."); return; }
    composeWindow.current = window.open("about:blank", "_blank");
    setSending(channel);
    send.mutate({ invoiceId, channel });
  };
  const downloadPdf = async () => {
    setDownloading(true);
    try { const pdf = await utils.client.invoiceDocs.downloadPdf.query({ invoiceId }); downloadBase64Pdf(pdf.content, pdf.filename); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not generate the PDF"); }
    finally { setDownloading(false); }
  };
  const copy = (value: string) => { navigator.clipboard?.writeText(value).then(() => toast.success("Copied to clipboard")).catch(() => toast.error("Could not copy")); };
  return { editing, setEditing, sending, downloading, sendResult, setSendResult, save, startSend, downloadPdf, copy };
}
