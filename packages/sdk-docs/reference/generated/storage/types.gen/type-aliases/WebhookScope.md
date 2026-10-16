# Type Alias: WebhookScope

> **WebhookScope** = `"user"` \| `"team"`

Scope that owns a newly-created webhook.

Clients serialize this, so both derives are used. `Display`/`FromStr`
spell the same names as serde, for query strings and config values.
