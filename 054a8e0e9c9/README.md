# IMAP fingerprint and recent-id lookups: database plan evidence

Source commit `054a8e0e9c96ac13f0f7eeb05d78966b5b79843e`, tree `d40a00735f09c7e12ad6e85974e224153f3d4333`. Lookup SQL `e4d4d2f8751929be…`, migration 20261119063901 `75e1feca1d672984…`.
PostgreSQL 14 on synthetic data in new databases; buffers, rows and plan shape only. No wall-time, native, production or provider claims.

## Red: previous `= ANY` fingerprint lookup (superseded)
The generic plan kept only `link_id` in the index condition and filtered fingerprints: 101,077 buffers for 0-2 result rows on a 100,000-location account (custom 3-5).

## Green: key-driven fingerprint lookup
Dataset: 100,000 links, 999,991 locations, 939,991 distinct digests (multiplicity 1x 889,991 / 2x 40,000 / 3x 10,000), non-unique partial index.
80 measurements (10 requests x fresh/stale x custom/generic x first/repeat): rows equal to an index-free oracle 80/80, index condition on link_id and fingerprint 80/80, byte-order keys 80/80, sequential scans 0, maximum 2050 buffers.

## Full schema (all 943 forward migrations, sqlx ledger verified)
The v3 run measured 128 cells; 104 cells use SQL unchanged in the current source.
The 24 full-Sync/synthetic-control cells remain historical. The current actual
full-Sync call is measured in 8 new paired cells below. No point/list lookup scanned the table.
- Recent-id location lookup: actual 100 ids 400 buffers with either plan (previous: 302 custom / 101,199 generic); 500-id control 2,000 (previous 1,508 / 101,199).
- Fingerprint lookup, 500 digests: 2,000 buffers with either plan.
- 500-row upsert: measured 250 inserted and 250 conflicting (updated) tuples; rolled back.
- Account fence: valid account true, stale revision false.

## Current full-account hydration: remove the inert sort
The application normalizes hydration through its BTreeMap, so the SQL sort has
no effect on matching. On the same 240,520-row six-kind input, all 8 current plans
have no Sort and write no temporary blocks. The previous plans spill to disk:
2,441 temporary blocks in fresh plans and 4,882 in the stale custom plan. Current
buffer counts remain proportional to the account's metadata. A whole-account
sequential scan is expected; this is not a point-lookup or constant-time claim.

## Limits
Synthetic data and local PostgreSQL 14 only; one hot account shape; intermediate harness attempts are listed in the JSON and are not evidence.

Measurements: [measurements.json](measurements.json), SHA-256 `b2c298bfebba1e4321e38efc8a02c86708e22d50648cfddd6c2e102bb724409b`.

HOLD MERGE; no deploy.
