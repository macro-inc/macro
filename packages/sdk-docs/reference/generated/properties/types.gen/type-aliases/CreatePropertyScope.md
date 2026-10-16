# Type Alias: CreatePropertyScope

> **CreatePropertyScope** = `"user"` \| `"team"`

Ownership scope a client may request when creating a property definition.
The owning user or team is derived server-side from the authenticated caller -
clients never supply owner ids. System properties are not creatable via the API.
