import {
  INVOICE_TAGLINE, formatInvoiceMoney, formatPlainAmount, templateBusinessLines, templateClientLines, templateFooter, templateHeadline,
  templateMetaRows, templatePaymentRows, templatePaymentsReceived, templateProjectDetails, templateTotalRows, type InvoiceView,
} from "@shared/invoice";

/** The 45Creatives invoice / quotation template. Used in the CRM, on public links, and when printing. */
export default function InvoiceSheet({ view }: { view: InvoiceView }) {
  const name = view.business.name || "45Creatives";
  const isQuote = view.kind === "quote";
  const docName = isQuote ? "Quotation" : "Invoice";
  const money = (value: number) => formatInvoiceMoney(value, view.currency);
  const headline = templateHeadline(view);
  const projectDetails = templateProjectDetails(view);
  const totals = templateTotalRows(view);
  const payRows = templatePaymentRows(view);
  const received = templatePaymentsReceived(view);
  const qty = (value: number) => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return <article className="inv-sheet" aria-label={`${docName} ${view.number}`}>
    <header className="inv-head">
      <h1 className="inv-doc-title">{docName}</h1>
      <div className="inv-brand"><p className="inv-brand-name">{name}</p><p className="inv-tagline">{INVOICE_TAGLINE}</p></div>
    </header>
    <dl className="inv-meta">{templateMetaRows(view).map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    <section className="inv-parties">
      <div><h3>{name}</h3>{templateBusinessLines(view).map((line, i) => <p key={i}>{line}</p>)}</div>
      <div><h3>{isQuote ? "Prepared for" : "Bill to"}</h3>{templateClientLines(view).map((line, i) => <p key={i}>{line}</p>)}</div>
    </section>
    <p className="inv-headline">{headline.amount} {headline.text}</p>
    {view.project.name.trim() ? <p className="inv-project">Project: {view.project.name}</p> : null}
    {projectDetails.length ? <p className="inv-project-details">{projectDetails.join(" · ")}</p> : null}
    <div className="inv-table-wrap"><table className="inv-table">
      <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
      <tbody>{view.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{qty(item.quantity)}</td><td>{money(item.unitPrice)}</td><td>{money(item.amount)}</td></tr>)}</tbody>
    </table></div>
    <dl className="inv-totals">{totals.map((row, index) => <div key={row.label} className={index === totals.length - 1 ? "inv-totals-final" : undefined}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    <section className="inv-howto">
      {isQuote ? <>
        <h3>Next steps</h3>
        <p>{view.decision ? <><strong>{view.status === "ACCEPTED" ? "Accepted" : "Declined"}</strong> by {view.decision.by} on {view.decision.at}.{view.decision.note ? ` Note: ${view.decision.note}` : ""}</> : `Accept this quotation online with the link you received, or reply to confirm. Please quote ${view.number} in any correspondence.`}</p>
      </> : <>
        <h3>How to pay</h3>
        {payRows.length ? <dl className="inv-pay-rows">{payRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl> : <p>Payment details available on request.</p>}
        {view.currency !== "KES" ? <p className="inv-pay-note">Payments in Kenya shillings are credited at KSh {formatPlainAmount(view.exchangeRate)} per {view.currency}.</p> : null}
        {received.length ? <>
          <h3 className="inv-received-title">Payments received</h3>
          <dl className="inv-pay-rows inv-received">{received.map((row, i) => <div key={i}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
        </> : null}
      </>}
    </section>
    <p className="inv-note">{view.terms.join(" ")}</p>
    {view.notes.trim() ? <p className="inv-note">{view.notes.trim()}</p> : null}
    <footer className="inv-foot"><p>{templateFooter(view)}</p></footer>
  </article>;
}
