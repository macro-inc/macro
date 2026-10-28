SET LOCAL lock_timeout = '5s';

ALTER TABLE comms_message_threads
    VALIDATE CONSTRAINT comms_message_threads_anchor_check;
