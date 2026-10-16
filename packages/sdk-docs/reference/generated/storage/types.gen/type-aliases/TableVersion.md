# Type Alias: TableVersion

> **TableVersion** = `number`

Monotonic per-table version, bumped once by every committed change to a
table's schema or rows. Schema edits name the version they were made
against, and change events carry the new one.
