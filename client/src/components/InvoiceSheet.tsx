import { INVOICE_TAGLINE, formatInvoiceMoney, invoiceTermRuns, type InvoiceView } from "@shared/invoice";

function Pair({ label, value }: { label: string; value: string }) {
  return value.trim() ? <p><strong>{label}</strong> {value}</p> : null;
}

/** The 45Creatives invoice template. Used in the CRM, on the public invoice link, and when printing. */
export default function InvoiceSheet({ view }: { view: InvoiceView }) {
  const name = view.business.name || "45Creatives";
  const mark = /^(\d+)(.+)$/.exec(name);
  const { payment, paymentRecord, totals } = view;
  const hasPaymentDetails = Boolean(payment.mpesaNumber || payment.bankName || payment.bankAccountNumber);
  return <article className="inv-sheet" aria-label={`Invoice ${view.number}`}>
    <header className="inv-head">
      <div>
        <h2 className="inv-wordmark">{mark ? <>{mark[1]}<span>{mark[2]}</span></> : name}</h2>
        <p className="inv-tagline">{INVOICE_TAGLINE}</p>
        <p className="inv-contact">{view.business.address}{view.business.address ? <br /> : null}{[view.business.email, view.business.phone].filter(Boolean).join(" \u00B7 ")}{view.business.website ? <><br />{view.business.website}</> : null}</p>
      </div>
      <div className="inv-title">
        <h1>INVOICE</h1>
        <p>STATUS: <strong className={`inv-status inv-status-${view.status.toLowerCase()}`}>{view.status}</strong><br />Invoice no. {view.number}<br />Issue date {view.issueDate}<br />Due date {view.dueDate}</p>
      </div>
    </header>
    <div className="inv-rule" />
    <section className="inv-info">
      <div><h3>BILL TO</h3>
        <Pair label="Client / Company:" value={view.billTo.client} /><Pair label="Contact person:" value={view.billTo.contact} /><Pair label="Email:" value={view.billTo.email} /><Pair label="Phone:" value={view.billTo.phone} /><Pair label="Billing address:" value={view.billTo.address} />
      </div>
      <div><h3>PROJECT DETAILS</h3>
        <Pair label="Project:" value={view.project.name} /><Pair label="Scope:" value={view.project.scope} /><Pair label="Quotation / contract ref:" value={view.project.quotationRef} /><Pair label="Payment terms:" value={view.project.paymentTerms} /><Pair label="Project milestone:" value={view.project.milestone} />
      </div>
    </section>
    <h3 className="inv-section">ITEMIZED SERVICES</h3>
    <div className="inv-table-wrap"><table className="inv-table">
      <thead><tr><th>DESCRIPTION</th><th>QTY</th><th>UNIT PRICE (KSh)</th><th>AMOUNT (KSh)</th></tr></thead>
      <tbody>{view.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{item.quantity}</td><td>{formatInvoiceMoney(item.unitPrice).replace("KSh ", "")}</td><td>{formatInvoiceMoney(item.amount).replace("KSh ", "")}</td></tr>)}</tbody>
    </table></div>
    <section className="inv-money">
      <div className="inv-pay">
        <h3>PAYMENT INSTRUCTIONS</h3>
        {payment.mpesaNumber ? <p><strong>M-Pesa:</strong> {payment.mpesaNumber} {"\u00B7"} Account: {payment.mpesaAccount}</p> : null}
        {payment.bankName || payment.bankAccountNumber ? <p><strong>Bank:</strong> {[payment.bankName, payment.bankAccountName && `Account name: ${payment.bankAccountName}`, payment.bankAccountNumber && `Account no.: ${payment.bankAccountNumber}`].filter(Boolean).join(" \u00B7 ")}</p> : null}
        {!hasPaymentDetails ? <p>Payment details available on request.</p> : null}
        <p><strong>Reference:</strong> Please quote {payment.reference} when paying{payment.confirmationContact ? ` and send confirmation to ${payment.confirmationContact}` : ""}.</p>
        <h3>PAYMENT RECORD</h3>
        {paymentRecord ? <><Pair label="Payment date:" value={paymentRecord.date} /><Pair label="Method:" value={paymentRecord.method} /><Pair label="Transaction reference:" value={paymentRecord.reference} /><Pair label="Amount received:" value={formatInvoiceMoney(paymentRecord.amount)} />{paymentRecord.count > 1 ? <p>{paymentRecord.count} payments recorded in total.</p> : null}</> : <p>No payment recorded yet.</p>}
      </div>
      <dl className="inv-totals">
        <div><dt>Subtotal</dt><dd>{formatInvoiceMoney(totals.subtotal)}</dd></div>
        <div><dt>Discount (if applicable)</dt><dd>{formatInvoiceMoney(totals.discount)}</dd></div>
        <div className="inv-total"><dt>INVOICE TOTAL</dt><dd>{formatInvoiceMoney(totals.total)}</dd></div>
        <div><dt>Deposit / payments received</dt><dd>{totals.received > 0 ? `(${formatInvoiceMoney(totals.received)})` : formatInvoiceMoney(0)}</dd></div>
        <div className="inv-balance"><dt>BALANCE DUE</dt><dd>{formatInvoiceMoney(totals.balance)}</dd></div>
      </dl>
    </section>
    <section className="inv-terms">
      <h3>TERMS &amp; NOTES</h3>
      <ul>{view.terms.map((term) => <li key={term}>{invoiceTermRuns(term).map((run, i) => run.bold ? <strong key={i}>{run.text}</strong> : <span key={i}>{run.text}</span>)}</li>)}{view.notes.trim() ? <li>Notes / special instructions: {view.notes.trim()}</li> : null}</ul>
    </section>
    <footer className="inv-foot">
      <p><strong>Thank you for choosing {name}.</strong> We appreciate your business.</p>
      <p>{[view.business.website, view.business.email, view.business.phone].filter(Boolean).join(" \u00B7 ")}</p>
    </footer>
  </article>;
}
