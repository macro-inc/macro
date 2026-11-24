-- no-transaction
-- A person's or a team's time over a period (My week, Team) reads entries by
-- person and day. Carries the task and minutes so those sums read the index only.
CREATE INDEX CONCURRENTLY time_entry_user_date
ON time_entry (user_id, entry_date DESC, id DESC) INCLUDE (task_id, minutes);
