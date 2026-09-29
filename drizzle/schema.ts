import { relations } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import type { ContractFields } from "../shared/contract";

export const appRole = pgEnum("app_role", ["owner", "admin", "member"]);
export const memberStatus = pgEnum("member_status", ["active", "invited", "suspended"]);
export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "expired", "revoked"]);
export const leadStatus = pgEnum("lead_status", ["new", "contacted", "qualified", "proposal", "negotiation", "won", "lost", "nurturing"]);
export const projectStatus = pgEnum("project_status", ["planning", "in-progress", "on-hold", "completed", "cancelled"]);
export const invoiceStatus = pgEnum("invoice_status", ["draft", "sent", "partial", "paid", "overdue", "void"]);
export const paymentStatus = pgEnum("payment_status", ["pending", "completed", "failed", "refunded"]);
export const transactionType = pgEnum("transaction_type", ["income", "expense", "transfer"]);
export const contractStatus = pgEnum("contract_status", ["draft", "sent", "signed", "voided"]);
// Mirrors Documenso's own envelope lifecycle (DRAFT/PENDING/COMPLETED/REJECTED/CANCELLED), kept as
// free text rather than a matching enum since Documenso may add values independently of this app.
export const documensoStatus = pgEnum("documenso_status", ["draft", "pending", "completed", "rejected", "cancelled"]);

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 320 }).notNull(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  providerImageUrl: text("provider_image_url"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in", { withTimezone: true }),
}, (t) => [uniqueIndex("users_email_idx").on(t.email)]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 160 }).notNull(),
  slug: varchar("slug", { length: 160 }).notNull(),
  currency: varchar("currency", { length: 8 }).default("KES").notNull(),
  timezone: varchar("timezone", { length: 80 }).default("Africa/Nairobi").notNull(),
  businessEmail: varchar("business_email", { length: 255 }),
  businessPhone: varchar("business_phone", { length: 40 }),
  businessAddress: varchar("business_address", { length: 255 }),
  leadWebhookSecret: varchar("lead_webhook_secret", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("workspaces_slug_idx").on(t.slug)]);

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: appRole("role").default("member").notNull(),
  status: memberStatus("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("workspace_members_user_idx").on(t.userId)]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("sessions_token_hash_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId), index("sessions_workspace_idx").on(t.workspaceId)]);

export const workspaceInvitations = pgTable("workspace_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 320 }).notNull(),
  role: appRole("role").default("member").notNull(),
  status: invitationStatus("status").default("pending").notNull(),
  tokenHash: varchar("token_hash", { length: 128 }).notNull(),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("workspace_invitations_workspace_idx").on(t.workspaceId), uniqueIndex("workspace_invitations_token_idx").on(t.tokenHash)]);

export const clients = pgTable("clients", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 180 }).notNull(),
  company: varchar("company", { length: 180 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 40 }),
  status: varchar("status", { length: 32 }).default("active").notNull(),
  notes: text("notes"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("clients_workspace_idx").on(t.workspaceId), index("clients_company_idx").on(t.workspaceId, t.company)]);

export const leads = pgTable("leads", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  name: varchar("name", { length: 180 }).notNull(),
  company: varchar("company", { length: 180 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 40 }),
  source: varchar("source", { length: 80 }),
  status: leadStatus("status").default("new").notNull(),
  estimatedValue: integer("estimated_value").default(0).notNull(),
  assignedToUserId: uuid("assigned_to_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("leads_workspace_idx").on(t.workspaceId), index("leads_status_idx").on(t.workspaceId, t.status)]);

export const services = pgTable("services", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 160 }).notNull(),
  description: text("description"),
  basePrice: integer("base_price").default(0).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("services_workspace_idx").on(t.workspaceId)]);

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  name: varchar("name", { length: 180 }).notNull(),
  status: projectStatus("status").default("planning").notNull(),
  progress: integer("progress").default(0).notNull(),
  budget: integer("budget").default(0).notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("projects_workspace_idx").on(t.workspaceId), index("projects_status_idx").on(t.workspaceId, t.status)]);

export const projectTasks = pgTable("project_tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
  title: varchar("title", { length: 220 }).notNull(),
  status: varchar("status", { length: 32 }).default("todo").notNull(),
  priority: varchar("priority", { length: 32 }).default("normal").notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("project_tasks_workspace_idx").on(t.workspaceId), index("project_tasks_project_idx").on(t.projectId)]);

export const quotes = pgTable("quotes", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  number: varchar("number", { length: 60 }).notNull(),
  status: varchar("status", { length: 32 }).default("draft").notNull(),
  subtotal: integer("subtotal").default(0).notNull(),
  tax: integer("tax").default(0).notNull(),
  total: integer("total").default(0).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("quotes_workspace_number_idx").on(t.workspaceId, t.number), index("quotes_workspace_idx").on(t.workspaceId)]);

export const quoteItems = pgTable("quote_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  quoteId: uuid("quote_id").notNull().references(() => quotes.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
  description: varchar("description", { length: 300 }).notNull(),
  quantity: integer("quantity").default(1).notNull(),
  unitPrice: integer("unit_price").default(0).notNull(),
  total: integer("total").default(0).notNull(),
});

export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  quoteId: uuid("quote_id").references(() => quotes.id, { onDelete: "set null" }),
  number: varchar("number", { length: 60 }).notNull(),
  status: invoiceStatus("status").default("draft").notNull(),
  subtotal: integer("subtotal").default(0).notNull(),
  tax: integer("tax").default(0).notNull(),
  total: integer("total").default(0).notNull(),
  amountPaid: integer("amount_paid").default(0).notNull(),
  issueDate: timestamp("issue_date", { withTimezone: true }).defaultNow().notNull(),
  dueDate: timestamp("due_date", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("invoices_workspace_number_idx").on(t.workspaceId, t.number), index("invoices_workspace_idx").on(t.workspaceId), index("invoices_status_idx").on(t.workspaceId, t.status)]);

export const invoiceItems = pgTable("invoice_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  serviceId: uuid("service_id").references(() => services.id, { onDelete: "set null" }),
  description: varchar("description", { length: 300 }).notNull(),
  quantity: integer("quantity").default(1).notNull(),
  unitPrice: integer("unit_price").default(0).notNull(),
  total: integer("total").default(0).notNull(),
});

export const payments = pgTable("payments", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  number: varchar("number", { length: 60 }).notNull(),
  amount: integer("amount").default(0).notNull(),
  method: varchar("method", { length: 60 }),
  status: paymentStatus("status").default("completed").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("payments_workspace_number_idx").on(t.workspaceId, t.number), index("payments_workspace_idx").on(t.workspaceId)]);

export const expenses = pgTable("expenses", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  category: varchar("category", { length: 100 }).notNull(),
  description: varchar("description", { length: 300 }).notNull(),
  amount: integer("amount").default(0).notNull(),
  incurredAt: timestamp("incurred_at", { withTimezone: true }).defaultNow().notNull(),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("expenses_workspace_idx").on(t.workspaceId)]);

export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  reference: varchar("reference", { length: 100 }),
  description: varchar("description", { length: 300 }).notNull(),
  type: transactionType("type").notNull(),
  amount: integer("amount").default(0).notNull(),
  transactionDate: timestamp("transaction_date", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("transactions_workspace_idx").on(t.workspaceId)]);

export const inventoryItems = pgTable("inventory_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 180 }).notNull(),
  category: varchar("category", { length: 100 }).notNull(),
  sku: varchar("sku", { length: 80 }),
  quantity: integer("quantity").default(0).notNull(),
  unitCost: integer("unit_cost").default(0).notNull(),
  reorderLevel: integer("reorder_level").default(1).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("inventory_workspace_idx").on(t.workspaceId), uniqueIndex("inventory_workspace_sku_idx").on(t.workspaceId, t.sku)]);

export const contracts = pgTable("contracts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  title: varchar("title", { length: 200 }).notNull(),
  status: contractStatus("status").default("draft").notNull(),
  providerName: varchar("provider_name", { length: 160 }).notNull(),
  providerEmail: varchar("provider_email", { length: 320 }),
  providerPhone: varchar("provider_phone", { length: 40 }),
  clientName: varchar("client_name", { length: 180 }).notNull(),
  clientEmail: varchar("client_email", { length: 320 }),
  clientPhone: varchar("client_phone", { length: 40 }),
  fields: jsonb("fields").$type<ContractFields>().default({} as ContractFields).notNull(),
  documentText: text("document_text").notNull(),
  documentHtml: text("document_html").notNull(),
  providerSignatureName: varchar("provider_signature_name", { length: 160 }),
  providerSignedAt: timestamp("provider_signed_at", { withTimezone: true }),
  clientSignatureName: varchar("client_signature_name", { length: 160 }),
  clientSignatureImageUrl: text("client_signature_image_url"),
  clientSignedAt: timestamp("client_signed_at", { withTimezone: true }),
  clientSignatureIp: varchar("client_signature_ip", { length: 64 }),
  tokenHash: varchar("token_hash", { length: 128 }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  // Documenso audit-trail layer: our own signing flow above stays the primary UX; these track the
  // parallel Documenso envelope used purely to obtain a certified, legally auditable signature.
  documensoEnvelopeId: varchar("documenso_envelope_id", { length: 160 }),
  documensoStatus: documensoStatus("documenso_status"),
  documensoProviderSigningUrl: text("documenso_provider_signing_url"),
  documensoClientSigningUrl: text("documenso_client_signing_url"),
  documensoCertifiedPdfPath: text("documenso_certified_pdf_path"),
  documensoCompletedAt: timestamp("documenso_completed_at", { withTimezone: true }),
  // WhatsApp Cloud API delivery & tracking
  whatsappMessageId: varchar("whatsapp_message_id", { length: 160 }),
  whatsappDeliveryStatus: varchar("whatsapp_delivery_status", { length: 32 }),
  whatsappSentAt: timestamp("whatsapp_sent_at", { withTimezone: true }),
  whatsappDeliveredAt: timestamp("whatsapp_delivered_at", { withTimezone: true }),
  whatsappReadAt: timestamp("whatsapp_read_at", { withTimezone: true }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("contracts_workspace_idx").on(t.workspaceId), index("contracts_client_idx").on(t.clientId), index("contracts_project_idx").on(t.projectId), uniqueIndex("contracts_token_hash_idx").on(t.tokenHash), index("contracts_wa_msg_idx").on(t.whatsappMessageId)]);

export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  uploadedByUserId: uuid("uploaded_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  objectKey: varchar("object_key", { length: 500 }).notNull(),
  originalName: varchar("original_name", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 120 }).notNull(),
  sizeBytes: integer("size_bytes").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("files_workspace_idx").on(t.workspaceId)]);

export const activityEvents = pgTable("activity_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  entityType: varchar("entity_type", { length: 60 }).notNull(),
  entityId: varchar("entity_id", { length: 96 }).notNull(),
  action: varchar("action", { length: 80 }).notNull(),
  detail: text("detail").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("activity_workspace_idx").on(t.workspaceId), index("activity_entity_idx").on(t.entityType, t.entityId), index("activity_created_idx").on(t.createdAt)]);

export const whatsappMessages = pgTable("whatsapp_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
  contractId: uuid("contract_id").references(() => contracts.id, { onDelete: "set null" }),
  direction: varchar("direction", { length: 16 }).default("outbound").notNull(),
  phone: varchar("phone", { length: 40 }).notNull(),
  waMessageId: varchar("wa_message_id", { length: 160 }),
  messageType: varchar("message_type", { length: 32 }).default("text").notNull(),
  body: text("body").notNull(),
  status: varchar("status", { length: 32 }).default("sent").notNull(),
  errorMessage: text("error_message"),
  metadata: jsonb("metadata"),
  sentAt: timestamp("sent_at", { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("wa_messages_workspace_idx").on(t.workspaceId),
  index("wa_messages_client_idx").on(t.clientId),
  index("wa_messages_contract_idx").on(t.contractId),
  index("wa_messages_wa_id_idx").on(t.waMessageId),
  index("wa_messages_phone_idx").on(t.workspaceId, t.phone),
  index("wa_messages_created_idx").on(t.createdAt),
]);

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type WhatsAppMessage = typeof whatsappMessages.$inferSelect;

export const workspaceRelations = relations(workspaces, ({ many }) => ({ members: many(workspaceMembers), clients: many(clients), leads: many(leads), projects: many(projects), quotes: many(quotes), invoices: many(invoices), payments: many(payments), expenses: many(expenses), transactions: many(transactions), inventoryItems: many(inventoryItems), activityEvents: many(activityEvents), contracts: many(contracts), whatsappMessages: many(whatsappMessages) }));
export const userRelations = relations(users, ({ many }) => ({ memberships: many(workspaceMembers), sessions: many(sessions) }));
export const clientRelations = relations(clients, ({ many }) => ({ leads: many(leads), projects: many(projects), quotes: many(quotes), invoices: many(invoices), payments: many(payments), contracts: many(contracts), whatsappMessages: many(whatsappMessages) }));
export const projectRelations = relations(projects, ({ many }) => ({ tasks: many(projectTasks), contracts: many(contracts) }));
export const contractRelations = relations(contracts, ({ one, many }) => ({ workspace: one(workspaces, { fields: [contracts.workspaceId], references: [workspaces.id] }), client: one(clients, { fields: [contracts.clientId], references: [clients.id] }), project: one(projects, { fields: [contracts.projectId], references: [projects.id] }), whatsappMessages: many(whatsappMessages) }));
export const whatsappMessagesRelations = relations(whatsappMessages, ({ one }) => ({ workspace: one(workspaces, { fields: [whatsappMessages.workspaceId], references: [workspaces.id] }), client: one(clients, { fields: [whatsappMessages.clientId], references: [clients.id] }), contract: one(contracts, { fields: [whatsappMessages.contractId], references: [contracts.id] }) }));
export const quoteRelations = relations(quotes, ({ many }) => ({ items: many(quoteItems) }));
export const invoiceRelations = relations(invoices, ({ many }) => ({ items: many(invoiceItems), payments: many(payments) }));
