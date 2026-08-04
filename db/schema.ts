import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const businesses = sqliteTable("businesses", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  employeeJoinCode: text("employee_join_code").unique(),
  createdAt: integer("created_at").notNull(),
});

export const employees = sqliteTable(
  "employees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    businessId: text("business_id").notNull().references(() => businesses.id),
    name: text("name").notNull(),
    role: text("role").notNull(),
    initials: text("initials").notNull(),
    color: text("color").notNull().default("green"),
    email: text("email"),
    phone: text("phone"),
    displayName: text("display_name"),
    availability: text("availability"),
    desiredHours: integer("desired_hours").notNull().default(0),
    address: text("address"),
    profilePhoto: text("profile_photo"),
    accessCodeHash: text("access_code_hash"),
    passwordHash: text("password_hash"),
    hourlyRateCents: integer("hourly_rate_cents").notNull().default(0),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at"),
  },
  (table) => [
    uniqueIndex("employees_business_email_idx").on(
      table.businessId,
      table.email,
    ),
    index("employees_business_idx").on(table.businessId),
  ],
);

export const workspaceSettings = sqliteTable("workspace_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const owners = sqliteTable(
  "owners",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    businessId: text("business_id").notNull().references(() => businesses.id),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("owners_business_idx").on(table.businessId)],
);

export const timeEntries = sqliteTable("time_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  employeeId: integer("employee_id").notNull().references(() => employees.id),
  clockIn: integer("clock_in", { mode: "timestamp_ms" }).notNull(),
  clockOut: integer("clock_out", { mode: "timestamp_ms" }),
  note: text("note"),
});

export const employeePayments = sqliteTable(
  "employee_payments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    amountCents: integer("amount_cents").notNull(),
    paidAt: integer("paid_at").notNull(),
    note: text("note"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("employee_payments_employee_idx").on(table.employeeId)],
);

export const appSessions = sqliteTable("app_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  access: text("access").notNull(),
  employeeId: integer("employee_id").references(() => employees.id),
  ownerId: integer("owner_id").references(() => owners.id),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull(),
  windowStart: integer("window_start").notNull(),
  lockedUntil: integer("locked_until").notNull().default(0),
});
