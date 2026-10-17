-- Invoice template details + send tracking (one row per invoice).
-- `npm run db:push` creates this from drizzle/schema.ts; this file is for manual migrations.
CREATE TABLE IF NOT EXISTS invoice_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  share_version integer NOT NULL DEFAULT 1,
  sent_at timestamptz,
  last_sent_channel varchar(16),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_documents_invoice_idx ON invoice_documents (invoice_id);
CREATE INDEX IF NOT EXISTS invoice_documents_workspace_idx ON invoice_documents (workspace_id);
