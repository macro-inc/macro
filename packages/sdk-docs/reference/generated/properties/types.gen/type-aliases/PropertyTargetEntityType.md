# Type Alias: PropertyTargetEntityType

> **PropertyTargetEntityType** = `"CALL_RECORD"` \| `"CHANNEL"` \| `"CHAT"` \| `"COMPANY"` \| `"DATABASE_ROW"` \| `"DOCUMENT"` \| `"INITIATIVE"` \| `"PROJECT"` \| `"THREAD"` \| `"USER"`

Canonical type of an entity receiving properties.

Tasks are documents at API boundaries. `Task` intentionally does not exist
here; task classification is resolved by the properties domain from the
document subtype.
