import { INVOICE_TAGLINE, currencyPrefix, formatInvoiceMoney, formatPlainAmount, invoiceTermRuns, type InvoiceView } from "@shared/invoice";

function Pair({ label, value }: { label: string; value: string }) {
  return value.trim() ? <p><strong>{label}</strong> {value}</p> : null;
}

/** The 45Creatives invoice / quotation template. Used in the CRM, on public links, and when printing. */
export default function InvoiceSheet({ view }: { view: InvoiceView }) {
  const name = view.business.name || "45Creatives";
  const mark = /^(\d+)(.+)$/.exec(name);
  const { payment, paymentRecord, totals } = view;
  const isQuote = view.kind === "quote";
  const docName = isQuote ? "Quotation" : "Invoice";
  const money = (value: number) => formatInvoiceMoney(value, view.currency);
  const prefix = currencyPrefix(view.currency);
  const hasPaymentDetails = Boolean(payment.mpesaNumber || payment.bankName || payment.bankAccountNumber);
  return <article className="inv-sheet" aria-label={`${docName} ${view.number}`}>
    <header className="inv-head">
      <div>
        <h2 className="inv-wordmark">{mark ? <>{mark[1]}<span>{mark[2]}</span></> : name}</h2>
        <p className="inv-tagline">{INVOICE_TAGLINE}</p>
        <p className="inv-contact">{view.business.address}{view.business.address ? <br /> : null}{[view.business.email, view.business.phone].filter(Boolean).join(" · ")}{view.business.website ? <><br />{view.business.website}</> : null}</p>
      </div>
      <div className="inv-title">
        <h1>{isQuote ? "QUOTATION" : "INVOICE"}</h1>
        <p>STATUS: <strong className={`inv-status inv-status-${view.status.toLowerCase()}`}>{view.status}</strong><br />{docName} no. {view.number}<br />Issue date {view.issueDate}<br />{isQuote ? "Valid until" : "Due date"} {view.dueDate}{view.currency !== "KES" ? <><br />Currency {view.currency}</> : null}</p>
      </div>
    </header>
    <div className="inv-rule" />
    <section className="inv-info">
      <div><h3>{isQuote ? "PREPARED FOR" : "BILL TO"}</h3>
        <Pair label="Client / Company:" value={view.billTo.client} /><Pair label="Contact person:" value={view.billTo.contact} /><Pair label="Email:" value={view.billTo.email} /><Pair label="Phone:" value={view.billTo.phone} /><Pair label="Billing address:" value={view.billTo.address} />
      </div>
      <div><h3>PROJECT DETAILS</h3>
        <Pair label="Project:" value={view.project.name} /><Pair label="Scope:" value={view.project.scope} /><Pair label="Quotation / contract ref:" value={view.project.quotationRef} /><Pair label="Payment terms:" value={view.project.paymentTerms} /><Pair label="Project milestone:" value={view.project.milestone} />
      </div>
    </section>
    <h3 className="inv-section">{isQuote ? "QUOTED SERVICES" : "ITEMIZED SERVICES"}</h3>
    <div className="inv-table-wrap"><table className="inv-table">
      <thead><tr><th>DESCRIPTION</th><th>QTY</th><th>UNIT PRICE ({prefix})</th><th>AMOUNT ({prefix})</th></tr></thead>
      <tbody>{view.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{item.quantity}</td><td>{formatPlainAmount(item.unitPrice)}</td><td>{formatPlainAmount(item.amount)}</td></tr>)}</tbody>
    </table></div>
    <section className="inv-money">
      <div className="inv-pay">
        {isQuote ? <>
          <h3>NEXT STEPS</h3>
          {view.decision ? <p><strong>{view.status === "ACCEPTED" ? "Accepted" : "Declined"}</strong> by {view.decision.by} on {view.decision.at}.{view.decision.note ? ` Note: ${view.decision.note}` : ""}</p> : <p>Accept this quotation online with the link you received, or reply to confirm. Valid until {view.dueDate}.</p>}
          <p><strong>Reference:</strong> Please quote {view.number} in any correspondence.</p>
        </> : <>
          <h3>PAYMENT INSTRUCTIONS</h3>
          {payment.mpesaNumber ? <p><strong>M-Pesa:</strong> {payment.mpesaNumber} {"·"} Account: {payment.mpesaAccount}</p> : null}
          {payment.bankName || payment.bankAccountNumber ? <p><strong>Bank:</strong> {[payment.bankName, payment.bankAccountName && `Account name: ${payment.bankAccountName}`, payment.bankAccountNumber && `Account no.: ${payment.bankAccountNumber}`].filter(Boolean).join(" · ")}</p> : null}
          {!hasPaymentDetails ? <p>Payment details available on request.</p> : null}
          <p><strong>Reference:</strong> Please quote {payment.reference} when paying{payment.confirmationContact ? ` and send confirmation to ${payment.confirmationContact}` : ""}.</p>
          {view.currency !== "KES" ? <p>Payments in Kenya shillings are credited at KSh {formatPlainAmount(view.exchangeRate)} per {view.currency}.</p> : null}
          <h3>PAYMENT RECORD</h3>
          {paymentRecord ? <><Pair label="Payment date:" value={paymentRecord.date} /><Pair label="Method:" value={paymentRecord.method} /><Pair label="Transaction reference:" value={paymentRecord.reference} /><Pair label="Amount received:" value={money(paymentRecord.amount)} />{paymentRecord.count > 1 ? <p>{paymentRecord.count} payments recorded in total.</p> : null}</> : <p>No payment recorded yet.</p>}
        </>}
      </div>
      <dl className="inv-totals">
        <div><dt>Subtotal</dt><dd>{money(totals.subtotal)}</dd></div>
        <div><dt>Discount (if applicable)</dt><dd>{money(totals.discount)}</dd></div>
        <div className="inv-total"><dt>{isQuote ? "QUOTATION TOTAL" : "INVOICE TOTAL"}</dt><dd>{money(totals.total)}</dd></div>
        {isQuote ? null : <>
          <div><dt>Deposit / payments received</dt><dd>{totals.received > 0 ? `(${money(totals.received)})` : money(0)}</dd></div>
          <div className="inv-balance"><dt>BALANCE DUE</dt><dd>{money(totals.balance)}</dd></div>
        </>}
      </dl>
    </section>
    <section className="inv-terms">
      <h3>TERMS &amp; NOTES</h3>
      <ul>{view.terms.map((term) => <li key={term}>{invoiceTermRuns(term).map((run, i) => run.bold ? <strong key={i}>{run.text}</strong> : <span key={i}>{run.text}</span>)}</li>)}{view.notes.trim() ? <li>Notes / special instructions: {view.notes.trim()}</li> : null}</ul>
    </section>
    <footer className="inv-foot">
      <p><strong>Thank you for choosing {name}.</strong> We appreciate your business.</p>
      <p>{[view.business.website, view.business.email, view.business.phone].filter(Boolean).join(" · ")}</p>
    </footer>
  </article>;
}
