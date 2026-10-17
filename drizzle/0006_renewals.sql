-- Recurring services (hosting, domains, maintenance, SSL, email...) billed to clients.
-- `npm run db:push` creates this from drizzle/schema.ts; this file is for manual migrations.
CREATE TABLE IF NOT EXISTS renewals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  contract_id uuid REFERENCES contracts(id) ON DELETE SET NULL,
  client_name varchar(180) NOT NULL,
  type varchar(32) NOT NULL DEFAULT 'hosting',
  name varchar(180) NOT NULL,
  provider varchar(120),
  cycle varchar(16) NOT NULL DEFAULT 'yearly',
  amount integer NOT NULL DEFAULT 0,
  cost integer NOT NULL DEFAULT 0,
  next_due_date timestamptz NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'active',
  notes text,
  last_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  last_invoiced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS renewals_workspace_idx ON renewals (workspace_id);
CREATE INDEX IF NOT EXISTS renewals_due_idx ON renewals (workspace_id, next_due_date);
