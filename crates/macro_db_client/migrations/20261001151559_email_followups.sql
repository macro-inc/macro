-- Additive: generic reminders retain their existing behavior.
ALTER TABLE email_threads ADD COLUMN reminder_returned_at TIMESTAMPTZ;

-- Workflow state belongs to reminders; email mutations remain email-owned.
CREATE TABLE reminder_email_followup (
    reminder_id UUID PRIMARY KEY REFERENCES reminder(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    state TEXT NOT NULL CHECK (state IN ('archiving', 'pending', 'returning', 'returned', 'cancelled', 'removed')),
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reminder_email_followup_active
    ON reminder_email_followup(user_id, thread_id)
    WHERE state IN ('archiving', 'pending', 'returning');
CREATE INDEX reminder_email_followup_thread
    ON reminder_email_followup(user_id, thread_id, created_at DESC);
CREATE INDEX reminder_email_followup_reconcile
    ON reminder_email_followup(reminder_id)
    WHERE state IN ('archiving', 'pending', 'returning');

-- Retain request identities after removal so a delayed retry cannot resurrect it.
CREATE TABLE reminder_email_operation (
    user_id TEXT NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
    operation_id UUID NOT NULL,
    thread_id UUID NOT NULL REFERENCES email_threads(id) ON DELETE CASCADE,
    request JSONB NOT NULL,
    reminder_id UUID NOT NULL REFERENCES reminder(id) ON DELETE CASCADE,
    PRIMARY KEY(user_id, operation_id)
);
