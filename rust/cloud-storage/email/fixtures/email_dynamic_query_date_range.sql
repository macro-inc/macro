-- Fixture for testing date range filters on email threads
-- Updates threads with explicit created_at timestamps to allow date filtering tests
--
-- Timeline for threads (created_at):
--   Thread 1: 2024-01-15 10:00:00+00 (newest)
--   Thread 2: 2024-01-14 09:00:00+00
--   Thread 3: 2024-01-13 08:00:00+00
--   Thread 4: 2024-01-12 07:00:00+00
--   Thread 5: 2024-01-11 06:00:00+00
--   Thread 6: 2024-01-10 05:00:00+00
--   Thread 7: 2024-01-09 04:00:00+00
--   Thread 8: 2024-01-08 03:00:00+00
--   Thread 9: 2024-01-07 02:00:00+00
--   Thread 10: 2024-01-06 01:00:00+00
--   Thread 11: 2024-01-05 00:00:00+00 (oldest)

UPDATE email_threads SET created_at = '2024-01-15 10:00:00+00' WHERE id = '20000001-0000-0000-0000-000000000001';
UPDATE email_threads SET created_at = '2024-01-14 09:00:00+00' WHERE id = '20000002-0000-0000-0000-000000000002';
UPDATE email_threads SET created_at = '2024-01-13 08:00:00+00' WHERE id = '20000003-0000-0000-0000-000000000003';
UPDATE email_threads SET created_at = '2024-01-12 07:00:00+00' WHERE id = '20000004-0000-0000-0000-000000000004';
UPDATE email_threads SET created_at = '2024-01-11 06:00:00+00' WHERE id = '20000005-0000-0000-0000-000000000005';
UPDATE email_threads SET created_at = '2024-01-10 05:00:00+00' WHERE id = '20000006-0000-0000-0000-000000000006';
UPDATE email_threads SET created_at = '2024-01-09 04:00:00+00' WHERE id = '20000007-0000-0000-0000-000000000007';
UPDATE email_threads SET created_at = '2024-01-08 03:00:00+00' WHERE id = '20000008-0000-0000-0000-000000000008';
UPDATE email_threads SET created_at = '2024-01-07 02:00:00+00' WHERE id = '20000009-0000-0000-0000-000000000009';
UPDATE email_threads SET created_at = '2024-01-06 01:00:00+00' WHERE id = '20000010-0000-0000-0000-000000000010';
UPDATE email_threads SET created_at = '2024-01-05 00:00:00+00' WHERE id = '20000011-0000-0000-0000-000000000011';
