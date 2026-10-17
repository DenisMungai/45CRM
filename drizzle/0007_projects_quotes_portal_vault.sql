-- Milestones & tasks, change requests & time, quote documents, payment reminders, M-Pesa matching,
-- client portal, client vault and multi-currency settings.
-- `npm run db:push` creates all of this from drizzle/schema.ts; this file is for manual migrations.

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS mpesa_webhook_secret varchar(64);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS reminders_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS default_hourly_rate integer NOT NULL DEFAULT 0;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS exchange_rates jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_version integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS project_milestones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  description text,
  due_date timestamptz,
  amount integer NOT NULL DEFAULT 0,
  status varchar(24) NOT NULL DEFAULT 'pending',
  client_note text,
  decided_by_name varchar(160),
  decided_at timestamptz,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS milestones_project_idx ON project_milestones (project_id);
CREATE INDEX IF NOT EXISTS milestones_workspace_idx ON project_milestones (workspace_id);

ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS milestone_id uuid REFERENCES project_milestones(id) ON DELETE SET NULL;
ALTER TABLE project_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE TABLE IF NOT EXISTS change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title varchar(200) NOT NULL,
  description text,
  kind varchar(16) NOT NULL DEFAULT 'change',
  source varchar(16) NOT NULL DEFAULT 'internal',
  requested_by_name varchar(160),
  status varchar(16) NOT NULL DEFAULT 'requested',
  estimate_hours integer NOT NULL DEFAULT 0,
  amount integer NOT NULL DEFAULT 0,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS change_requests_project_idx ON change_requests (project_id);
CREATE INDEX IF NOT EXISTS change_requests_workspace_idx ON change_requests (workspace_id);

CREATE TABLE IF NOT EXISTS time_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  change_request_id uuid REFERENCES change_requests(id) ON DELETE SET NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  description varchar(300) NOT NULL,
  minutes integer NOT NULL,
  work_date timestamptz NOT NULL,
  billable boolean NOT NULL DEFAULT true,
  hourly_rate integer NOT NULL DEFAULT 0,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS time_entries_project_idx ON time_entries (project_id);
CREATE INDEX IF NOT EXISTS time_entries_workspace_idx ON time_entries (workspace_id);

CREATE TABLE IF NOT EXISTS quote_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  share_version integer NOT NULL DEFAULT 1,
  sent_at timestamptz,
  last_sent_channel varchar(16),
  decision varchar(16),
  decided_by_name varchar(160),
  decision_note text,
  decided_at timestamptz,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS quote_documents_quote_idx ON quote_documents (quote_id);
CREATE INDEX IF NOT EXISTS quote_documents_workspace_idx ON quote_documents (workspace_id);

CREATE TABLE IF NOT EXISTS invoice_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  stage varchar(24) NOT NULL,
  channel varchar(16) NOT NULL,
  status varchar(16) NOT NULL,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invoice_reminders_stage_idx ON invoice_reminders (invoice_id, stage, channel);
CREATE INDEX IF NOT EXISTS invoice_reminders_workspace_idx ON invoice_reminders (workspace_id);

CREATE TABLE IF NOT EXISTS mpesa_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  trans_id varchar(40) NOT NULL,
  amount integer NOT NULL,
  account_ref varchar(80),
  payer_name varchar(160),
  payer_phone varchar(40),
  paid_at timestamptz NOT NULL,
  source varchar(16) NOT NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  payment_id uuid REFERENCES payments(id) ON DELETE SET NULL,
  status varchar(16) NOT NULL DEFAULT 'unmatched',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS mpesa_transactions_trans_idx ON mpesa_transactions (workspace_id, trans_id);
CREATE INDEX IF NOT EXISTS mpesa_transactions_workspace_idx ON mpesa_transactions (workspace_id);

CREATE TABLE IF NOT EXISTS client_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  kind varchar(16) NOT NULL,
  name varchar(200) NOT NULL,
  url text,
  username varchar(200),
  secret_encrypted text,
  notes text,
  mime_type varchar(120),
  size_bytes integer NOT NULL DEFAULT 0,
  content bytea,
  visibility varchar(16) NOT NULL DEFAULT 'internal',
  source varchar(16) NOT NULL DEFAULT 'team',
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_assets_client_idx ON client_assets (client_id);
CREATE INDEX IF NOT EXISTS client_assets_workspace_idx ON client_assets (workspace_id);
