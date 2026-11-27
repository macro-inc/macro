SET LOCAL lock_timeout = '5s';

-- Keep work identity and a closed failure class for operators without retaining
-- malformed provider or user data.
CREATE TABLE email_mailbox_work_quarantine (
    work TEXT NOT NULL CHECK (work IN ('commands', 'drafts', 'projection')),
    work_id UUID NOT NULL,
    link_id UUID NOT NULL REFERENCES email_links(id) ON DELETE CASCADE,
    reason TEXT NOT NULL CHECK (reason IN (
        'decode', 'probe_budget', 'probe_accounting', 'missing_disposition'
    )),
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    cleanup_at TIMESTAMPTZ,
    PRIMARY KEY (work, work_id)
);

CREATE INDEX email_mailbox_work_quarantine_cleanup
    ON email_mailbox_work_quarantine (cleanup_at, work_id)
    WHERE cleanup_at IS NOT NULL;
