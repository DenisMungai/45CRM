export type ParsedMpesa = { transId: string; amount: number; payerName: string | null; payerPhone: string | null; paidAt: Date | null; accountRef: string | null };

/**
 * Reads an M-Pesa confirmation SMS, e.g.
 *   "QJK1ABC2DE Confirmed. Ksh5,000.00 received from JOHN DOE 254712345678 on 17/10/26 at 3:45 PM. Account Number 45C-INV-0001 New Utility balance is ..."
 *   "QJK1ABC2DE Confirmed.You have received Ksh5,000.00 from JANE W 0712345678 on 17/10/26 at 9:05 AM New M-PESA balance is ..."
 * Returns null when the text isn't a received-payment confirmation.
 */
export function parseMpesaSms(text: string): ParsedMpesa | null {
  const sms = (text || "").replace(/\s+/g, " ").trim();
  const id = /\b([A-Z0-9]{10})\s+Confirmed/i.exec(sms);
  const amount = /Ksh\s?([\d,]+(?:\.\d{1,2})?)\s+(?:received\s+)?from\b/i.exec(sms) || /received\s+Ksh\s?([\d,]+(?:\.\d{1,2})?)/i.exec(sms);
  if (!id || !amount) return null;
  const payer = /from\s+(.+?)\s+(\+?\d{9,12})?\s*on\s+\d/i.exec(sms);
  const when = /on\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(sms);
  const account = /(?:Account(?:\s+Number|\s+No\.?)?|for\s+account)\s*:?\s*([A-Z0-9][A-Z0-9-]{1,40})/i.exec(sms);
  let paidAt: Date | null = null;
  if (when) {
    const year = Number(when[3]) < 100 ? 2000 + Number(when[3]) : Number(when[3]);
    let hour = Number(when[4]) % 12;
    if ((when[6] || "").toUpperCase() === "PM") hour += 12;
    if (!when[6]) hour = Number(when[4]);
    // M-Pesa times are Nairobi time (UTC+3).
    paidAt = new Date(Date.UTC(year, Number(when[2]) - 1, Number(when[1]), hour - 3, Number(when[5])));
  }
  return {
    transId: id[1].toUpperCase(),
    amount: Math.round(Number(amount[1].replace(/,/g, ""))),
    payerName: payer?.[1]?.trim() || null,
    payerPhone: payer?.[2] || null,
    paidAt,
    accountRef: account?.[1]?.replace(/[.,]$/, "") || null,
  };
}

/** Daraja C2B "TransTime" (yyyyMMddHHmmss, Nairobi time) as a Date. */
export function parseDarajaTime(value: string | number | undefined): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(value ?? ""));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 3, Number(m[5]), Number(m[6]))) : null;
}
