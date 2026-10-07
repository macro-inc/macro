UPDATE database_columns
SET position = position || '80'
WHERE position IN ('20', '40', '60');
