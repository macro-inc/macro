-- Validate after the initial DDL transaction releases its stronger locks.
-- These scans allow concurrent message reads and writes.
SET LOCAL lock_timeout = '5s';

ALTER TABLE comms_messages
    VALIDATE CONSTRAINT comms_messages_parent_type_check,
    VALIDATE CONSTRAINT comms_messages_call_thread_check;
