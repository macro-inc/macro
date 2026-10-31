# Type Alias: SqlEntityKind

> **SqlEntityKind** = `"USER"` \| `"DOCUMENT"` \| `"TASK"` \| `"COMPANY"` \| `"CONTACT"` \| `"CALL_RECORD"` \| `"CHANNEL"` \| `"CHAT"` \| `"PROJECT"` \| `"THREAD"` \| `"CALENDAR_EVENT"` \| `"INITIATIVE"` \| `"DATABASE_ROW"`

What an entity column's references point at: a kind of Macro entity, or
the rows of another table for a relation.

Spelled as the properties system spells entity types (`USER`,
`DATABASE_ROW`), on the wire and in SQL, where it parses
case-insensitively.
