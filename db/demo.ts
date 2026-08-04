const DEMO_BUSINESS_ID = "hourmark-public-demo";

type DemoDatabase = ReturnType<typeof import("./runtime").database>;

export function isDemoBusiness(businessId: string) {
  return businessId === DEMO_BUSINESS_ID;
}

export async function resetDemoWorkspace(db: DemoDatabase) {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const employees = [
    [-1101, "Ava Thompson", "Operations Manager", "AT", "violet", "ava@demo.coreshift.app", 3200],
    [-1102, "Marcus Lee", "Shift Lead", "ML", "blue", "marcus@demo.coreshift.app", 2750],
    [-1103, "Sofia Ramirez", "Customer Support", "SR", "coral", "sofia@demo.coreshift.app", 2400],
    [-1104, "Noah Williams", "Sales Associate", "NW", "green", "noah@demo.coreshift.app", 2250],
    [-1105, "Mia Chen", "Coordinator", "MC", "violet", "mia@demo.coreshift.app", 2550],
  ] as const;
  const insertEmployee = db.prepare(`
    INSERT INTO employees (
      id, business_id, name, role, initials, color, email,
      access_code_hash, password_hash, hourly_rate_cents, active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, 1, ?)
  `);
  const insertTime = db.prepare(
    "INSERT INTO time_entries (employee_id, clock_in, clock_out, note) VALUES (?, ?, ?, ?)"
  );
  const insertPayment = db.prepare(`
    INSERT INTO employee_payments (employee_id, amount_cents, paid_at, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  await db.batch([
    db.prepare("DELETE FROM app_sessions WHERE employee_id IN (SELECT id FROM employees WHERE business_id = ?)").bind(DEMO_BUSINESS_ID),
    db.prepare("DELETE FROM employee_payments WHERE employee_id IN (SELECT id FROM employees WHERE business_id = ?)").bind(DEMO_BUSINESS_ID),
    db.prepare("DELETE FROM time_entries WHERE employee_id IN (SELECT id FROM employees WHERE business_id = ?)").bind(DEMO_BUSINESS_ID),
    db.prepare("DELETE FROM employees WHERE business_id = ?").bind(DEMO_BUSINESS_ID),
    ...employees.map((employee, index) => insertEmployee.bind(
      employee[0],
      DEMO_BUSINESS_ID,
      employee[1],
      employee[2],
      employee[3],
      employee[4],
      employee[5],
      employee[6],
      now - ((420 - index * 55) * day),
    )),
    insertTime.bind(-1101, now - 2.5 * hour, null, "Opening coverage"),
    insertTime.bind(-1101, now - 3 * day - 9 * hour, now - 3 * day - hour, "Operations review"),
    insertTime.bind(-1102, now - 9 * hour, now - hour, "Morning shift"),
    insertTime.bind(-1102, now - 2 * day - 8.5 * hour, now - 2 * day - hour, "Team lead shift"),
    insertTime.bind(-1103, now - 6 * hour, now - .5 * hour, "Customer queue"),
    insertTime.bind(-1103, now - 4 * day - 8 * hour, now - 4 * day - 1.5 * hour, "Support shift"),
    insertTime.bind(-1104, now - 32 * hour, now - 24 * hour, "Sales floor"),
    insertTime.bind(-1105, now - 5 * day - 7 * hour, now - 5 * day - hour, "Project coordination"),
    insertPayment.bind(-1101, 51200, now - 2 * hour, "Weekly payroll", now),
    insertPayment.bind(-1102, 44000, now - 3 * hour, "Weekly payroll", now),
    insertPayment.bind(-1103, 38400, now - 2 * day, "Weekly payroll", now - 2 * day),
    insertPayment.bind(-1104, 72000, now - 12 * day, "Biweekly payroll", now - 12 * day),
    insertPayment.bind(-1105, 120000, now - 40 * day, "Monthly payroll", now - 40 * day),
    insertPayment.bind(-1101, 180000, now - 120 * day, "Quarterly period", now - 120 * day),
    insertPayment.bind(-1102, 165000, now - 220 * day, "Prior payroll period", now - 220 * day),
    insertPayment.bind(-1103, 148000, now - 410 * day, "Historical payroll", now - 410 * day),
  ]);
}
