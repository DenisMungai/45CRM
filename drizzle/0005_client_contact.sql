-- Primary contact person for a client (the Clients table's "Primary contact" column).
-- `npm run db:push` creates this from drizzle/schema.ts; this file is for manual migrations.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS contact_name varchar(160);
