-- Marks macro_ids minted by shared-inbox promotion: a mailbox that several macro users
-- connected, with no human who logs in as it directly. Distinguishes these from real
-- accounts someone was delegated to (which a delegate leaving must NOT delete), so the
-- last delegate removing access can tear the mailbox down instead of orphaning it.
CREATE TABLE IF NOT EXISTS promoted_shared_mailboxes (
    macro_id   TEXT NOT NULL PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
