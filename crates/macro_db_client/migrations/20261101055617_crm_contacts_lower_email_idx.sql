-- no-transaction
-- The CRM depopulate lookup (crates/crm, `lock_depopulate_target`) and the
-- cleanup lister's `link_contact_pairs_with_sources` match LOWER(ct.email).
-- Without this index the lookup walks the team's companies and the lister
-- walks every source of each candidate link.
-- Keep this a single statement: SQLx batches would create an implicit
-- transaction, which CONCURRENTLY forbids. No IF NOT EXISTS: if an
-- interrupted build leaves an INVALID index, the next run fails on it instead
-- of recording success; drop it with DROP INDEX CONCURRENTLY and re-run.
CREATE INDEX CONCURRENTLY crm_contacts_lower_email_idx
    ON crm_contacts (LOWER(email));
