# Type Alias: SurfaceState

> **SurfaceState** = `"pending"` \| `"ready"`

Lifecycle state of a collab surface.

`Pending` means the row exists but the sync-service session may not: the
row is inserted before the durable object is initialized and flipped to
`Ready` once the initial snapshot is stored. A persisted `Pending` row is
an ensure that died or failed mid-init; the next ensure for the same id
retries initialization (the initializer tolerates an already-initialized
session), so `Pending` is self-healing rather than terminal.
