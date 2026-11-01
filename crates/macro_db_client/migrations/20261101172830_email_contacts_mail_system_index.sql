-- no-transaction
-- Each inbox's mail-system senders (mailer-daemon@, postmaster@), whose bounces
-- the email sequences read before every step. A few rows per inbox.
CREATE INDEX CONCURRENTLY IF NOT EXISTS email_contacts_mail_system_idx
    ON email_contacts (link_id)
    WHERE split_part(lower(email_address::text), '@', 1) IN ('mailer-daemon', 'postmaster');
