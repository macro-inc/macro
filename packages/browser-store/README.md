# @macro-inc/browser-store

Small, typed persistence primitives over IndexedDB, with in-memory twins for
tests and non-browser hosts.

- `SnapshotStore<T>`: one value per scope. `IDBSnapshotStore` keeps it in an
  object store keyed by scope id; `InMemorySnapshotStore` holds it in a field.
- `WALStore<T>`: an append-only log per scope with delivery marks and expiry.
  `BrowserWALStore` indexes entries by scope id; `InMemoryWALStore` is the
  test twin.

The package knows nothing about what it stores. Callers name the database,
the scope, and the value type, and may pass a `StoreLogger` to hear about
reads and writes.
