-- Dropping the foreign key takes ACCESS EXCLUSIVE on "User"; run only after
-- every reader of these tables is rolled back.
SET LOCAL lock_timeout = '5s';
DROP TABLE IF EXISTS mcp_event_subscription_event;
DROP TABLE IF EXISTS mcp_event_subscription;
