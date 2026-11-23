# Contacts list-member query evidence for #11484

Source: `d7e350efb5099fc9180cea0da69116b93dcf0982`, tree `094177d95442c16986cb4b6f0a0299f2219764fc`.

- [Exact IMAP query](https://github.com/macro-inc/macro/blob/d7e350efb5099fc9180cea0da69116b93dcf0982/crates/contacts/src/outbound/repository/directory/list_members/imap.sql)
- [Concurrent partial index](https://github.com/macro-inc/macro/blob/d7e350efb5099fc9180cea0da69116b93dcf0982/crates/macro_db_client/migrations/20261123181250_contact_inbox_members_imap_idx.sql)
- [Committed plan regression](https://github.com/macro-inc/macro/blob/d7e350efb5099fc9180cea0da69116b93dcf0982/crates/contacts/src/outbound/repository/directory/test/plans.rs)
- [Measurements and plans](measurements.json), SHA256 `da0f58c8d49afbf247b8fbfc1804bf0a16c3b545531862065b7fa0d664432488`.

The external matrix uses a synthetic PostgreSQL 14 fixture with 310,000 inbox-member rows: 100,000 distinct IMAP contacts for one owner, 10,000 duplicates across a second inbox, 100,000 Gmail contacts for the owner, and 100,000 background IMAP contacts. Statistics are first held at a 20-row sample, then refreshed with VACUUM ANALYZE. Both custom and generic plans cover first, continuation and empty pages, with requested page sizes 1 and 500.

All 24 runs use `contact_inbox_members_imap_idx`, without a Sort or sequential scan. Maximum shared buffers are 13 with fresh statistics and 1,013 before vacuum with stale statistics; the latter includes 1,001 bounded heap fetches. These local timings are not production latency or capacity claims.

The committed regression separately adds 100,000 IMAP contacts and 10,000 duplicate inbox entries to the existing list-plan fixture. It queries their actual owner in both custom and generic modes and requires the IMAP index. First, continuation, tail and empty cases use 13, 8, 4 and 3 buffers in each mode. Dropping only that index inside the isolated test fixture produces a red on the populated 501-row range; restoring the fixture produces a green. The full contacts suite passes 192 tests.

Viewer and cursor values in the custom plans are redacted; operators, node types, index names, row counts, timings and buffers are preserved. Source SQL and migration hashes bind the evidence to the code.

This is local SQL evidence. A running-service trace, real-provider trial, multi-replica throughput and human playback are not established here. HOLD MERGE; no deployment is claimed.
