/** Close open shifts that have reached an employee's configured limit. */
export async function autoClockOutExpiredEntries(db: D1Database, businessId: string, now = Date.now()) {
  await db.prepare(`
    UPDATE time_entries
    SET clock_out = clock_in + COALESCE((
      SELECT auto_clock_out_minutes FROM employees WHERE employees.id = time_entries.employee_id
    ), 0) * 60000
    WHERE clock_out IS NULL
      AND employee_id IN (
        SELECT id
        FROM employees
        WHERE business_id = ?
          AND COALESCE(auto_clock_out_minutes, 0) > 0
          AND auto_clock_out_starts_at IS NOT NULL
      )
      AND clock_in >= COALESCE((
        SELECT auto_clock_out_starts_at FROM employees WHERE employees.id = time_entries.employee_id
      ), ?)
      AND clock_in + COALESCE((
        SELECT auto_clock_out_minutes FROM employees WHERE employees.id = time_entries.employee_id
      ), 0) * 60000 <= ?
  `).bind(businessId, Number.MAX_SAFE_INTEGER, now).run();
}
