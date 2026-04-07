import { index, integer, jsonb, pgTable, serial, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });

const sharedColumns = {
  triggeredBy: text('triggered_by').notNull(),
  startedAt: timestamptz('started_at').defaultNow().notNull(),
  completedAt: timestamptz('completed_at'),
  details: jsonb('details'),
};

export const auditLog = pgTable('audit_log', {
  id: serial('id').primaryKey(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  payload: jsonb('payload'),
  performedAt: timestamptz('performed_at').defaultNow().notNull(),
});

export const syncHistory = pgTable('sync_history', {
  id: serial('id').primaryKey(),
  syncType: text('sync_type').notNull(),
  ...sharedColumns,
  invitedCount: integer('invited_count').default(0).notNull(),
  removedCount: integer('removed_count').default(0).notNull(),
  errorCount: integer('error_count').default(0).notNull(),
});

export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    status: text('status').notNull().default('pending'),
    ...sharedColumns,
    createdAt: timestamptz('created_at').defaultNow().notNull(),
    result: jsonb('result'),
  },
  (table) => [index('idx_sync_jobs_pending').on(table.type, table.status)],
);
