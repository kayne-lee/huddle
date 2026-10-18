import { relations } from "drizzle-orm";
import { index, pgEnum, pgTableCreator, primaryKey, uniqueIndex } from "drizzle-orm/pg-core";
import type { AdapterAccount } from "next-auth/adapters";

export const createTable = pgTableCreator((name) => `huddle_${name}`);

export const roleEnum = pgEnum("huddle_role", ["admin", "member", "viewer"]);
export const taskStatusEnum = pgEnum("huddle_task_status", ["queued", "running", "review", "approved", "failed"]);
export const visibilityEnum = pgEnum("huddle_visibility", ["org", "private"]);
export const runEventTypeEnum = pgEnum("huddle_run_event_type", [
  "status",
  "text",
  "tool_call",
  "tool_result",
  "steer",
  "error",
]);

export type Role = (typeof roleEnum.enumValues)[number];
export type TaskStatus = (typeof taskStatusEnum.enumValues)[number];
export type Visibility = (typeof visibilityEnum.enumValues)[number];
export type RunEventType = (typeof runEventTypeEnum.enumValues)[number];

export const users = createTable("user", (d) => ({
  id: d
    .varchar({ length: 255 })
    .notNull()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: d.varchar({ length: 255 }),
  email: d.varchar({ length: 255 }).notNull(),
  emailVerified: d.timestamp({ mode: "date", withTimezone: true }),
  image: d.varchar({ length: 255 }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  accounts: many(accounts),
  memberships: many(memberships),
}));

export const accounts = createTable(
  "account",
  (d) => ({
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    type: d.varchar({ length: 255 }).$type<AdapterAccount["type"]>().notNull(),
    provider: d.varchar({ length: 255 }).notNull(),
    providerAccountId: d.varchar({ length: 255 }).notNull(),
    refresh_token: d.text(),
    access_token: d.text(),
    expires_at: d.integer(),
    token_type: d.varchar({ length: 255 }),
    scope: d.varchar({ length: 255 }),
    id_token: d.text(),
    session_state: d.varchar({ length: 255 }),
  }),
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] }), index("account_user_id_idx").on(t.userId)],
);

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, { fields: [accounts.userId], references: [users.id] }),
}));

export const sessions = createTable(
  "session",
  (d) => ({
    sessionToken: d.varchar({ length: 255 }).notNull().primaryKey(),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [index("t_user_id_idx").on(t.userId)],
);

export const verificationTokens = createTable(
  "verification_token",
  (d) => ({
    identifier: d.varchar({ length: 255 }).notNull(),
    token: d.varchar({ length: 255 }).notNull(),
    expires: d.timestamp({ mode: "date", withTimezone: true }).notNull(),
  }),
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

export const orgs = createTable(
  "org",
  (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: d.varchar({ length: 255 }).notNull(),
    joinCode: d.varchar({ length: 32 }).notNull(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [uniqueIndex("org_join_code_idx").on(t.joinCode)],
);

export const orgsRelations = relations(orgs, ({ many }) => ({
  memberships: many(memberships),
  tasks: many(tasks),
}));

export const memberships = createTable(
  "membership",
  (d) => ({
    orgId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    userId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum().notNull(),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [primaryKey({ columns: [t.orgId, t.userId] }), index("membership_user_idx").on(t.userId)],
);

export const membershipsRelations = relations(memberships, ({ one }) => ({
  org: one(orgs, { fields: [memberships.orgId], references: [orgs.id] }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const tasks = createTable(
  "task",
  (d) => ({
    id: d
      .varchar({ length: 255 })
      .notNull()
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    orgId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => orgs.id, { onDelete: "cascade" }),
    createdById: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => users.id),
    title: d.varchar({ length: 255 }).notNull(),
    prompt: d.text().notNull(),
    status: taskStatusEnum().notNull().default("queued"),
    visibility: visibilityEnum().notNull().default("org"),
    draft: d.text().notNull().default(""),
    // Bumped on every draft write so concurrent editors detect conflicts.
    draftVersion: d.integer().notNull().default(0),
    draftEditedById: d.varchar({ length: 255 }).references(() => users.id),
    approvedById: d.varchar({ length: 255 }).references(() => users.id),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
    updatedAt: d
      .timestamp({ withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  }),
  (t) => [index("task_org_idx").on(t.orgId, t.createdAt)],
);

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  org: one(orgs, { fields: [tasks.orgId], references: [orgs.id] }),
  createdBy: one(users, { fields: [tasks.createdById], references: [users.id] }),
  events: many(runEvents),
}));

export const runEvents = createTable(
  "run_event",
  (d) => ({
    id: d.integer().primaryKey().generatedByDefaultAsIdentity(),
    taskId: d
      .varchar({ length: 255 })
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    type: runEventTypeEnum().notNull(),
    // Set for events a person caused (steering messages); null for agent events.
    userId: d.varchar({ length: 255 }).references(() => users.id),
    payload: d.jsonb().$type<Record<string, unknown>>().notNull(),
    // The runner marks steering messages consumed once they are in the model's context.
    consumed: d.boolean().notNull().default(false),
    createdAt: d.timestamp({ withTimezone: true }).defaultNow().notNull(),
  }),
  (t) => [index("run_event_task_idx").on(t.taskId, t.id)],
);

export const runEventsRelations = relations(runEvents, ({ one }) => ({
  task: one(tasks, { fields: [runEvents.taskId], references: [tasks.id] }),
  user: one(users, { fields: [runEvents.userId], references: [users.id] }),
}));
