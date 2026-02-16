import { integer, jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payload: jsonb('payload'),
  performedAt: timestamp('performed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const syncHistory = pgTable('sync_history', {
  id: serial('id').primaryKey(),
  syncType: text('sync_type').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  invitedCount: integer('invited_count').default(0).notNull(),
  removedCount: integer('removed_count').default(0).notNull(),
  errorCount: integer('error_count').default(0).notNull(),
  details: jsonb('details'),
  triggeredBy: text('triggered_by').notNull(),
});
