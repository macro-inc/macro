# Mailbox provider routing

Work rows derive provider metadata from their immutable link through the
routing trigger, including old-binary inserts. Stream rows were Outlook-only
before this rollout. Legacy reconciliation rows can carry the metadata-only
Outlook default for another provider; claims relabel at most 64 per due window,
return Progress and immediately poll again. Work that becomes due later follows
the same path. No background repair job, cursor, completion marker or runtime
DDL is needed. Legacy Gmail reconciliation rows have no native consumer on
main or here; keep them and repair routing rather than deleting data.

Single-claimer synthetic-harness transition measurements:

- A one-million-row legacy mislabelled prefix takes 169–184 seconds (about
  17–18 seconds per 100k). Relabelled entries leave dead index entries until
  vacuum; sampled calls reached 11,065 buffers. Record that one-time prefix
  separately from the standard claim-window gate.
- Parking 102,000 due live-stream rows of links needing reauthentication takes
  22.7 seconds before healthy work is acquired, with none left unparked.
- For 102,000 inactive-link reconciliation rows, healthy live work is acquired
  after 11.9 seconds and 68,000 live-order rows parked. The 34,000 import-order
  rows remain behind live work and are maintained later.

The authorized hosted-dev counts are zero for legacy non-Outlook reconciliation
rows and for due ineligible catalog, folder, live-pass and live/import message
rows. Production counts require explicit permission and remain unmeasured.

## Earlier local preview revisions

These unmerged revisions were never deployed. Removing migrations 250,
253–256, 261 and 262 and editing 251/252 makes SQLx reject local databases that
already applied the old set: applied-but-missing versions and changed checksums
are both errors. Full migration requires a fresh database or an explicitly
approved reset of a disposable database. Never edit the migration ledger to
hide incompatibility; preserve needed data and volumes.

The preserved preview keeps its data and old ledger. It cannot claim a full
migration pass on the revised source. Fresh owned scratch databases provide
full migration proof. Any separately authorized scoped schema adaptation of
the preserved preview must be recorded as local-only, not a successful full
SQLx migration or a production rollout rehearsal.
