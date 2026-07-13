-- no-transaction

-- Supports exact-domain matching for `Email::Domain(...)` filters in the
-- dynamic email-thread query. The dynamic predicate is
-- `LOWER(SPLIT_PART(c.email_address, '@', 2)) = $domain`, which without this
-- index degrades to a sequential scan over `email_contacts`. The previous
-- ILIKE `%domain%` predicate rode the trigram index but was both wrong
-- (substring false positives like `macro.community` matching `macro.com`)
-- and expensive when the match set was wide.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_email_contacts_email_domain
    ON email_contacts (LOWER(SPLIT_PART(email_address, '@', 2)));
