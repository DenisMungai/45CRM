# AGENTS.md

You are a senior full-stack engineer working on the **45Creatives CRM**, the internal operating system of 45Creatives, a Nairobi web design and development agency. Read this file before changing anything.

---

## 1. Product

One workspace-scoped dashboard where the agency runs its client work end to end:

- **Clients and leads**: client records with a primary contact, a lead pipeline, and a public lead-capture endpoint.
- **Agreements (contracts)**: generated service agreements, in-app signing by both parties, PDF, email and WhatsApp delivery. Optional Documenso signing runs in parallel.
- **Quotations**: line items, PDF, a public accept/decline link, and conversion to an invoice.
- **Invoices**: server-numbered (`45C-INV-0001`), template details, deposits, line items, PDF, print, email/WhatsApp hand-off, a public view link, and reminders.
- **Payments**: manual entry, M-Pesa confirmation-SMS parsing, Daraja C2B webhooks, and matching payments to invoices.
- **Projects**: milestones with client approval, tasks, change requests, time tracking, and one-click invoicing of milestones, changes and unbilled time.
- **Renewals**: hosting, domain, maintenance, SSL and email renewals, with margins and invoice-and-renew.
- **Client portal**: one private link per client covering invoices, quotes, agreements, milestones, change requests, files and renewals.
- **Vault**: per-client files, links and encrypted logins. Every reveal is logged.
- **Accounting, inventory and reports**: transactions, expenses, stock, and reports including GA4 website traffic.
- **Team**: workspace members, roles (owner/admin/member) and email invitations.
- **AI insight**: an optional OpenAI-compatible assistant with a safe fallback when no key is set.

The visual design is the dark **"Midnight Ledger"** dashboard UI. Preserve it. Client-facing documents (invoice, quote, agreement) use a light, printable **45Creatives template** (red `#d81b22`, black, grey panels).

Do not add features that weren't asked for, and do not redesign screens unprompted.

---

## 2. Tech stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19, Vite 5, TypeScript, Tailwind CSS 4, shadcn/ui (Radix), wouter, TanStack Query, sonner, recharts |
| API | Express 5 and tRPC 11 (superjson), Zod 4 validation |
| Database | PostgreSQL and Drizzle ORM (`drizzle/schema.ts`) |
| Auth | First-party email/password; opaque session tokens stored as SHA-256 hashes; HttpOnly cookie |
| PDFs | `pdf-lib` with the built-in Helvetica fonts (WinAnsi only) |
| Email / messaging | Resend (optional), WhatsApp Business Cloud API (optional), Gmail/WhatsApp draft links |
| Payments | M-Pesa (SMS parsing and Daraja C2B) |
| Hosting | Vercel (`api/index.ts` serverless function plus static `dist/public`) or the Node server |
| Tests | Vitest (node environment) |

Do not introduce another backend framework, ORM, auth provider, or state library. Do not store business data in `localStorage`. It is only used for UI conveniences: theme, a one-hour undo tray, and recent activity.

---

## 3. Repository layout

```
api/index.ts          Vercel serverless entry (Express app, no listen())
server/index.ts       Node entry (Express app + Vite dev proxy / static serving + reminder timer)
server/extraRoutes.ts Plain HTTP routes shared by BOTH entries (cron, M-Pesa, vault/portal uploads)
server/routers.ts     The tRPC appRouter (all app procedures)
server/_core/         trpc context + procedures, cookies, env (ENV), llm adapter, vite helpers
server/*.ts           Domain modules: crm, domain (row sync), invoiceDocs, quoteDocs, contracts,
                      projectWork, renewals, reminders, mpesa, portal, vault, shareLinks,
                      whatsapp*, documenso, emailDelivery, storage, googleAnalytics
server/*Pdf.ts        PDF renderers (invoicePdf, contractPdf)
shared/               Pure logic used by client AND server (invoice, contract, mpesa, renewal, reminders)
client/src/pages/     Home.tsx (the dashboard), Login, public pages: InvoiceView, QuoteView,
                      ContractSign, Portal, InviteAccept
client/src/components Feature components (InvoiceSheet, ProjectWorkspace, MpesaPanel, ...) and ui/ (shadcn)
client/src/index.css  All app styling (plain class names, dark theme, print rules)
drizzle/schema.ts     Source of truth for the database schema
drizzle/000N_*.sql    Hand-written, idempotent migrations for each schema change
scripts/seed.ts       Seeds the bootstrap admin and workspace
```

Path aliases: `@/*` → `client/src/*`, `@shared/*` → `shared/*`. Server code imports with relative paths and `.js` extensions (ESM).

`App.tsx` routes on `window.location.pathname`. Public pages (`/login`, `/invite/`, `/contracts/sign/`, `/invoices/view/`, `/quotes/view/`, `/portal/`) skip `AuthProvider`.

---

## 4. Architecture rules

- **Workspace scoping is mandatory.** Every business table has `workspace_id`. Every query in a protected procedure filters by `ctx.user.workspaceId`. Never trust a workspace or record id from the client without that filter.
- **Procedures:** use `protectedProcedure` for signed-in users and `adminProcedure` (in `routers.ts`) for settings, integrations and team management. Use `publicProcedure` only for login/invitation and token-guarded public documents.
- **Thin routers.** `routers.ts` validates input with Zod and calls a domain module. Put business logic in `server/<domain>.ts` and pure logic in `shared/`.
- **Plain HTTP routes** (webhooks, cron, raw uploads) go in `server/extraRoutes.ts` so both `server/index.ts` and `api/index.ts` register them. If you must touch auth/lead-capture/webhook routes, change **both** entry files identically.
- **Public links** are HMAC-signed tokens from `server/shareLinks.ts` (`<id>.<signature>`, with a version to revoke). Do not invent other token schemes. Rotating `SESSION_SECRET` invalidates links and makes vault passwords unreadable.
- **Errors:** throw `TRPCError` with a human message for expected failures. Unexpected errors are logged and replaced with a generic message by the error formatter, so never leak SQL or stack traces to the client.
- **Dashboard tables** (clients, leads, projects, quotes, invoices, payments, inventory, accounting) sync positional rows through `records.sync`, `server/domain.ts` and the typed tables. Rows are positional arrays, so keep column order stable and keep empty cells.

---

## 5. Domain rules

### Money, currency, dates
- Payments, dashboards and accounting are in **KES**. Invoices and quotes may be issued in KES, USD, EUR or GBP with an exchange rate. Payments are converted into the document's currency for display (`shared/invoice.ts`).
- Format money with `formatInvoiceMoney` (`KSh 1,234.00`) and dates with `formatInvoiceDate` (`19 Oct 2026`, Africa/Nairobi). Never rely on the server's timezone.

### Invoice and quote template
- `shared/invoice.ts` builds the `InvoiceView` and the **template helpers** (`templateMetaRows`, `templateBanner`, `templateFrom`, `templateBillTo`, `templateTotalRows`, `templatePaymentRows`, `templatePaymentsReceived`, `templateFooter`).
- Two renderers consume them and **must stay visually in sync**: `client/src/components/InvoiceSheet.tsx` with `.inv-*` styles in `index.css` (in-app, public link, print), and `server/invoicePdf.ts` (PDF download/attachment). Change wording or rows in the helpers, not in one renderer. Change layout in both.
- Invoice numbers come from the server (`nextInvoiceNumberFrom`, `45C-INV-` prefix). Lines without a unit price are omitted. Invoices don't print KRA PIN or tax sections.
- PDF text must pass through `pdfSafe` (WinAnsi). Long content must paginate.

### Payments and M-Pesa
- M-Pesa codes are normalised with `normaliseMpesaCode` and validated with `MPESA_CODE_PATTERN`. Matching uses the invoice number as the account number, or a unique exact balance. Unmatched payments are left for manual matching.
- Invoice status is derived (`deriveInvoiceStatus` / `nextStoredInvoiceStatus`) from payments, sent state and due date. Don't set it ad hoc.

### Reminders and cron
- Automatic reminders go out 3 days before the due date, on it, 7 days after, then every 14 days. They need Resend and `remindersEnabled`.
- On Vercel, `vercel.json` cron calls `GET /api/cron/reminders` (06:00 UTC = 09:00 Nairobi) with `Authorization: Bearer $CRON_SECRET`. The Node server runs them every 6 hours itself.

### Security
- Never expose server secrets to client code. Only `VITE_*` variables reach the browser.
- Vault passwords are encrypted, never shown in the portal, and every reveal is logged. Vault files are 4 MB max.
- Webhooks verify their secret or signature (Documenso secret, WhatsApp app secret, M-Pesa per-workspace secret in the URL).
- The lead-capture endpoint is rate limited. Keep it that way.

---

## 6. Database changes

1. Edit `drizzle/schema.ts`.
2. Add the next numbered, **idempotent** SQL file in `drizzle/` (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, and so on) for manual production migrations.
3. Document the migration in `README.md` (what it adds, and "run `npm run db:push` or apply `drizzle/000N_*.sql` before deploying").
4. Remember that production fails to load data until the migration is applied. Say so in your summary.

---

## 7. Environment variables

Canonical list: `.env.example`. Keep it in sync when adding variables, and never put real secrets in it. `.env` is git-ignored.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL`, `DATABASE_SSL`, `DB_POOL_MAX` | PostgreSQL connection |
| `SESSION_SECRET`, `SESSION_DAYS` | Session hashing, share-link HMAC, vault encryption key |
| `APP_URL` | Public HTTPS origin used in emailed/WhatsApp links |
| `BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD` | Seed admin (`npm run db:seed`) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional AI insight |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | Optional email (invitations, documents, reminders) |
| `CRON_SECRET` | Protects `/api/cron/reminders` |
| `WHATSAPP_*` | Optional WhatsApp Business Cloud API and webhook |
| `DOCUMENSO_*` | Optional parallel e-signature |
| `GA4_*` | Optional Reports → Website Traffic |

Every integration is optional. The app must keep working, with a clear message, when one isn't configured.

---

## 8. Code style

- TypeScript strict. No `any` unless unavoidable at a library boundary.
- Match the surrounding code: compact, mostly single-line handlers, small helpers, short JSDoc comments that explain *why*. Don't reformat files you aren't changing.
- Styling uses plain class names in `client/src/index.css`, following the existing naming (`.inv-*`, `.record-dialog*`, and so on). Every new UI must work at phone width (existing breakpoints are 1120px, 760px and 720px) and in print where relevant.
- UI copy is plain, friendly British/Kenyan English ("Send Money / Pochi", "KSh").
- Prefer editing existing modules over creating new ones. No unrelated refactors.

---

## 9. Workflow

1. Read this file, then the code you are about to change and its tests.
2. For a new feature, a schema change or a cross-cutting change, write a short plan first (goal, files, schema/migration, security notes, test steps) and get approval. Small fixes can go straight to code.
3. Implement, keeping client sheet and PDF, both API entries, and schema with its migration in sync.
4. Run the checks (section 10) and report the real output.
5. Give exact manual test steps (which page, which button, what to expect).

---

## 10. Commands and checks

```bash
npm run dev        # Vite (5173) + API (3000) with proxy
npm run check      # tsc --noEmit
npm test           # vitest run
npm run build      # vite build + esbuild server bundle -> dist/
npm run db:push    # apply drizzle/schema.ts to DATABASE_URL
npm run db:seed    # bootstrap admin + workspace
```

Always run `npm run check` and `npm test` after changes. Run `npm run build` when routes, config, entry files or shared modules change. There is no lint script; don't claim lint passed. Add or update Vitest tests in `server/*.test.ts` for logic in `shared/` and `server/`.

---

## 11. Git

- Work on a feature branch. Never commit directly to `main`.
- Commit messages are lowercase Conventional Commits that describe the user-visible change: `feat: record M-Pesa codes and amounts on invoices`, `fix: fit the invoice item table on phone screens`.
- Never commit `.env`, `uploads/`, `dist/` or `node_modules/`.
