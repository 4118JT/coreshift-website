DELETE FROM `time_entries`;
DELETE FROM `app_sessions`
WHERE `employee_id` IN (
  SELECT `id` FROM `employees`
  WHERE `name` IN ('Maya Thompson', 'Jordan Lee', 'Nina Patel', 'Sam Rivera', 'Eli Brooks')
);
DELETE FROM `employees`
WHERE `name` IN ('Maya Thompson', 'Jordan Lee', 'Nina Patel', 'Sam Rivera', 'Eli Brooks');
