# Type Alias: SyncStatus

> **SyncStatus** = `"SYNCING"` \| `"UP_TO_DATE"` \| `"ERROR"` \| `"NEEDS_REAUTH"` \| `"INACTIVE"`

Coarse sync state for an inbox, used to render a one-line hint in the
multi-inbox settings list. Derived from the link's `is_sync_active` flag, its
reauth health, and its most recent backfill job.
