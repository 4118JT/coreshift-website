DELETE FROM `time_entries`;
DELETE FROM `app_sessions` WHERE `access` = 'employee';
DELETE FROM `employees`;
DELETE FROM `sqlite_sequence` WHERE `name` = 'employees';
