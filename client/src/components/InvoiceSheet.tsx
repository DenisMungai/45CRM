import type { CSSProperties } from "react";
import {
  INVOICE_TAGLINE, formatInvoiceMoney, formatPlainAmount, templateBanner, templateBillTo, templateFooter, templateFrom,
  templateMetaRows, templatePaymentRows, templatePaymentsReceived, templateTotalRows, type InvoiceView, type TemplateParty,
} from "@shared/invoice";

function Party({ label, party }: { label: string; party: TemplateParty }) {
  return <div>
    <h3 className="inv-label">{label}</h3>
    <p className="inv-party-name">{party.name}</p>
    {party.lines.map((line, i) => <p key={i} className="inv-party-line">{line}</p>)}
    {party.contacts.map((line, i) => <p key={i} className="inv-party-contact">{line}</p>)}
  </div>;
}

/** The 45Creatives invoice / quotation template. Used in the CRM, on public links, and when printing. */
export default function InvoiceSheet({ view }: { view: InvoiceView }) {
  const isQuote = view.kind === "quote";
  const docName = isQuote ? "Quotation" : "Invoice";
  const money = (value: number) => formatInvoiceMoney(value, view.currency);
  const meta = templateMetaRows(view);
  const banner = templateBanner(view);
  const totals = templateTotalRows(view);
  const payRows = templatePaymentRows(view);
  const received = templatePaymentsReceived(view);
  const footer = templateFooter(view);
  const qty = (value: number) => Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return <article className="inv-sheet" aria-label={`${docName} ${view.number}`}>
    <header className="inv-head">
      <div>
        <p className="inv-brand-name">{templateFrom(view).name}</p>
        <h1 className="inv-doc-title">{docName}</h1>
      </div>
      <div className="inv-head-side">
        <p className="inv-tagline">{INVOICE_TAGLINE}</p>
        <p className="inv-number">{view.number}</p>
      </div>
    </header>
    <dl className="inv-meta" style={{ "--inv-cells": meta.length } as CSSProperties}>
      {meta.map((row) => <div key={row.label}><dt className="inv-label">{row.label}</dt><dd>{row.value}</dd></div>)}
    </dl>
    <section className="inv-parties">
      <Party label="From" party={templateFrom(view)} />
      <Party label={isQuote ? "Prepared for" : "Bill to"} party={templateBillTo(view)} />
    </section>
    <section className="inv-banner">
      <div className="inv-banner-amount"><p className="inv-label">{banner.amountLabel}</p><p className="inv-banner-value">{banner.amount}</p></div>
      <div className="inv-banner-due">
        <p className="inv-label">{banner.dateLabel}</p>
        <p className="inv-banner-date">{banner.date}</p>
        {banner.details ? <p className="inv-banner-details">{banner.details}</p> : null}
      </div>
    </section>
    <h2 className="inv-section-title">{docName} details</h2>
    <div className="inv-table-wrap"><table className="inv-table">
      <thead><tr><th>Description</th><th>Qty</th><th>Unit price</th><th>Amount</th></tr></thead>
      <tbody>{view.items.map((item, index) => <tr key={index}><td>{item.description}</td><td>{qty(item.quantity)}</td><td>{money(item.unitPrice)}</td><td>{money(item.amount)}</td></tr>)}</tbody>
    </table></div>
    <dl className="inv-totals">{totals.map((row, index) => <div key={row.label} className={index === totals.length - 1 ? "inv-totals-final" : row.label === "Total" ? "inv-totals-sum" : undefined}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
    <section className={received.length && !isQuote ? "inv-info two" : "inv-info"}>
      {isQuote ? <div>
        <h3>Next steps</h3>
        {view.decision
          ? <dl className="inv-info-rows"><div><dt>{view.status === "ACCEPTED" ? "Accepted" : "Declined"}</dt><dd>By {view.decision.by} on {view.decision.at}.{view.decision.note ? ` Note: ${view.decision.note}` : ""}</dd></div></dl>
          : <p className="inv-info-text">Accept this quotation online with the link you received, or reply to confirm. Please quote {view.number} in any correspondence.</p>}
      </div> : <>
        <div>
          <h3>How to pay</h3>
          {payRows.length ? <dl className="inv-info-rows">{payRows.map((row) => <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl> : <p className="inv-info-text">Payment details available on request.</p>}
          {view.currency !== "KES" ? <p className="inv-pay-note">Payments in Kenya shillings are credited at KSh {formatPlainAmount(view.exchangeRate)} per {view.currency}.</p> : null}
        </div>
        {received.length ? <div>
          <h3>Payments received</h3>
          <dl className="inv-info-rows">{received.map((row, i) => <div key={i}><dt>{row.label}</dt><dd>{row.value}</dd></div>)}</dl>
        </div> : null}
      </>}
    </section>
    <p className="inv-terms">{view.terms.join(" ")}</p>
    {view.notes.trim() ? <p className="inv-note">{view.notes.trim()}</p> : null}
    <footer className="inv-foot"><strong>{footer.thanks}</strong>{footer.website ? <span>{footer.website}</span> : null}</footer>
  </article>;
}
