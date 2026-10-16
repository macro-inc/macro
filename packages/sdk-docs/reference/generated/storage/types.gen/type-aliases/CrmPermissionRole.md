# Type Alias: CrmPermissionRole

> **CrmPermissionRole** = `"admin"` \| `"owner"`

Minimum team role required for a CRM governance capability. Members
can edit visible CRM records (e.g. company properties), but the
governance capabilities these settings gate stay restricted to
admin (default) vs owner. Maps to the `team_role` Postgres enum;
`member` is deliberately not representable.
