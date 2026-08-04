import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ships isolated CoreShift business accounts with owner payment tracking", async () => {
  const [
    page,
    dashboard,
    routedPage,
    viewer,
    employeeApi,
    employeeDetailApi,
    employeeTimeEntriesApi,
    employeePaymentsApi,
    expenseReportApi,
    paymentScheduleApi,
    aiAssistantApi,
    paymentApi,
    timeEntryApi,
    clockApi,
    accessCodeApi,
    ownersApi,
    registrationApi,
    employeeJoinApi,
    employeeJoinCodeApi,
    loginApi,
    logoutApi,
    ownerRecoveryApi,
    appAuth,
    loginForm,
    recoveryForm,
    demoData,
    demoMigration,
    wipeMigration,
    employeeJoinMigration,
    paymentsMigration,
    profileMigration,
    layout,
    serviceWorker,
    preview,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/timekeeper.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/[view]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/viewer.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employees/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employees/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employees/[id]/time-entries/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employees/[id]/payments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/reports/expenses/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/schedule/payments/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/assistant/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/payments/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/time-entries/[id]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employees/[id]/clock/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/employees/[id]/access-code/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/owners/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/register-owner/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/join-employee/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/settings/employee-join-code/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/login/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/logout/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/session/recover-owner/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../db/app-auth.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/login/login-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/recover-owner/recovery-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../db/demo.ts", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0014_public_demo_account.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0010_wipe_all_data.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0011_cheerful_colossus.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0012_illegal_iron_lad.sql", import.meta.url), "utf8"),
    readFile(new URL("../drizzle/0013_productive_lionheart.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/sw.js", import.meta.url), "utf8"),
    readFile(new URL("../public/og-coreshift.png", import.meta.url)),
  ]);

  assert.match(page, /viewer\.access === "employee"/);
  assert.match(page, /viewer=\{viewer\}/);
  assert.match(dashboard, /CoreShift/);
  assert.match(dashboard, /Who’s working/);
  assert.match(dashboard, /Timesheets/);
  assert.match(dashboard, />Log out</);
  assert.match(dashboard, /Help &amp; tips/);
  for (const view of ["time-clock", "timesheets", "schedule", "team", "reports", "settings"]) {
    assert.match(routedPage, new RegExp(`"${view}"`));
    assert.match(dashboard, new RegExp(view));
  }
  for (const view of ["employee-home", "my-hours", "my-schedule", "profile"]) {
    assert.match(dashboard, new RegExp(view));
  }
  assert.match(routedPage, /"assistant"/);
  assert.match(dashboard, /AI assistant/);
  assert.match(dashboard, /Private by role/);
  assert.match(dashboard, /Build my weekly labor report/);
  assert.match(dashboard, /Summarize my hours this week/);
  assert.match(viewer, /businessId/);
  assert.match(viewer, /businessName/);
  assert.doesNotMatch(viewer, /getChatGPTUser/);
  assert.match(employeeApi, /viewer\.employeeId/);
  assert.match(employeeApi, /Owner access required/);
  assert.match(employeeApi, /e\.business_id = \?/);
  assert.match(employeeApi, /INSERT INTO employees \(business_id/);
  assert.match(employeeDetailApi, /business_id = \?/);
  assert.match(employeeDetailApi, /DELETE FROM time_entries/);
  assert.match(employeeTimeEntriesApi, /INSERT INTO time_entries/);
  assert.match(employeePaymentsApi, /INSERT INTO employee_payments/);
  assert.match(employeePaymentsApi, /Owner access required/);
  assert.match(expenseReportApi, /Owner access required/);
  assert.match(paymentScheduleApi, /viewer\.access === "employee"/);
  assert.match(paymentScheduleApi, /viewer\.employeeId/);
  assert.match(paymentScheduleApi, /e\.business_id = \?/);
  assert.match(aiAssistantApi, /OPENAI_API_KEY/);
  assert.match(aiAssistantApi, /api\.openai\.com\/v1\/responses/);
  assert.match(aiAssistantApi, /model: "gpt-5\.6"/);
  assert.match(aiAssistantApi, /store: false/);
  assert.match(aiAssistantApi, /insufficient_quota/);
  assert.match(aiAssistantApi, /employee_self_only/);
  assert.match(aiAssistantApi, /viewer\.employeeId/);
  assert.match(aiAssistantApi, /e\.business_id = \?/);
  assert.match(expenseReportApi, /employee_payments/);
  assert.match(expenseReportApi, /e\.business_id = \?/);
  assert.match(expenseReportApi, /averageCents/);
  assert.match(expenseReportApi, /largestCents/);
  assert.match(expenseReportApi, /GROUP BY e\.id/);
  assert.match(expenseReportApi, /ORDER BY p\.paid_at DESC/);
  assert.match(paymentApi, /DELETE FROM employee_payments/);
  assert.match(paymentApi, /e\.business_id = \?/);
  assert.match(timeEntryApi, /UPDATE time_entries SET clock_in/);
  assert.match(timeEntryApi, /DELETE FROM time_entries/);
  assert.match(timeEntryApi, /e\.business_id = \?/);
  assert.match(clockApi, /only update your own time/);
  assert.match(clockApi, /business_id = \?/);
  assert.match(accessCodeApi, /business_id = \?/);
  assert.match(ownersApi, /business_id = \?/);
  assert.match(registrationApi, /INSERT INTO businesses/);
  assert.match(registrationApi, /employee_join_code/);
  assert.match(registrationApi, /INSERT INTO owners \(id, business_id/);
  assert.match(registrationApi, /INSERT INTO app_sessions/);
  assert.match(registrationApi, /buildAppSession/);
  assert.match(registrationApi, /verifyPassword/);
  assert.match(registrationApi, /SELECT 1 FROM app_sessions/);
  assert.match(registrationApi, /Unable to create the business account/);
  assert.match(registrationApi, /signup:v2:/);
  assert.match(registrationApi, /INSERT INTO login_attempts/);
  assert.match(loginApi, /business_id = \?/);
  assert.match(loginApi, /verifyPassword/);
  assert.match(loginApi, /employee_join_code/);
  assert.match(loginApi, /resetDemoWorkspace/);
  assert.match(demoData, /hourmark-public-demo/);
  assert.match(demoData, /DELETE FROM employee_payments/);
  assert.match(demoData, /INSERT INTO employee_payments/);
  assert.match(demoMigration, /demo@hourmark\.app/);
  assert.match(demoMigration, /pbkdf2\$100000/);
  assert.match(employeeJoinApi, /INSERT INTO employees/);
  assert.match(employeeJoinApi, /hashPassword/);
  assert.match(employeeJoinApi, /buildAppSession/);
  assert.match(employeeJoinApi, /employee-join:/);
  assert.match(employeeJoinCodeApi, /Owner access required/);
  assert.match(employeeJoinCodeApi, /generateAccessCode/);
  assert.match(employeeJoinCodeApi, /UPDATE businesses SET employee_join_code/);
  assert.match(logoutApi, /export async function POST/);
  assert.match(logoutApi, /Max-Age=0/);
  assert.match(dashboard, /window\.location\.replace\("\/login"\)/);
  assert.match(appAuth, /PASSWORD_ITERATIONS = 100_000/);
  assert.match(accessCodeApi, /business=/);
  assert.match(loginForm, /Create business account/);
  assert.match(loginForm, /Join a company/);
  assert.match(loginForm, /8-digit company code/);
  assert.match(loginForm, /Forgot your password/);
  assert.match(ownerRecoveryApi, /OWNER_RECOVERY_TOKEN/);
  assert.match(ownerRecoveryApi, /owner-recovery-used/);
  assert.match(ownerRecoveryApi, /DELETE FROM app_sessions WHERE owner_id/);
  assert.match(ownerRecoveryApi, /hashPassword/);
  assert.match(recoveryForm, /One-time recovery code/);
  for (const table of [
    "time_entries",
    "app_sessions",
    "login_attempts",
    "employees",
    "owners",
    "businesses",
    "workspace_settings",
  ]) {
    assert.match(wipeMigration, new RegExp(`DELETE FROM .${table}.`));
  }
  assert.match(dashboard, /Estimated earned/);
  assert.match(dashboard, /does not send funds/);
  assert.match(dashboard, /Edit time/);
  assert.match(dashboard, /Active time entry/);
  assert.match(dashboard, /Payment history/);
  assert.match(dashboard, /Still unpaid/);
  assert.match(dashboard, /Mark paid/);
  assert.match(dashboard, /Member since/);
  assert.match(dashboard, /Hours this month/);
  assert.match(dashboard, /Average shift length/);
  assert.match(dashboard, /Current pay period earnings/);
  assert.match(dashboard, /Expense report/);
  assert.match(dashboard, /\["month", "Month"/);
  assert.match(dashboard, /\["year", "Year"/);
  assert.match(dashboard, /All time/);
  assert.match(dashboard, /Recorded payments only/);
  assert.match(dashboard, /Money owed/);
  assert.match(dashboard, /Owed \+ paid/);
  assert.match(dashboard, /Spending by employee/);
  assert.match(dashboard, /Expense report period/);
  assert.match(dashboard, /Every payment/);
  assert.match(dashboard, /Date paid/);
  assert.match(dashboard, /Complete .* payment history/);
  assert.match(dashboard, /Payment received/);
  assert.match(dashboard, /Recorded payments/);
  assert.match(dashboard, /Copy previous week/);
  assert.match(dashboard, /Duplicate week/);
  assert.match(dashboard, /Planned shifts/);
  assert.match(dashboard, /Shift templates/);
  assert.match(dashboard, /Drag a shift to another day or resize it to change the duration/);
  assert.match(dashboard, /api\/schedule\/payments/);
  assert.match(employeeApi, /monthMinutes/);
  assert.match(employeeApi, /totalShifts/);
  assert.match(employeeApi, /currentPayPeriodEarningsCents/);
  assert.match(employeeJoinMigration, /employee_join_code/);
  assert.match(employeeJoinMigration, /password_hash/);
  assert.match(paymentsMigration, /CREATE TABLE .employee_payments./);
  assert.match(profileMigration, /ADD .created_at./);
  assert.match(profileMigration, /UPDATE employees\s+SET created_at/);
  assert.match(layout, /CoreShift — Simple employee time tracking/);
  assert.match(serviceWorker, /coreshift-shell-v1/);
  assert.match(serviceWorker, /APP_SHELL\.includes\(url\.pathname\)/);
  assert.doesNotMatch(serviceWorker, /cache\.put\(event\.request/);
  assert.ok(preview.byteLength > 100_000);
});
