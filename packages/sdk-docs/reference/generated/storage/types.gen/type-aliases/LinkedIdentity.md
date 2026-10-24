# Type Alias: LinkedIdentity

> **LinkedIdentity** = \{ `alternateJid?`: `string` \| `null`; `displayName?`: `string` \| `null`; `jid`: `string`; \}

Verified sender aliases, supplied only by protocol metadata.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-alternatejid"></a> `alternateJid?` | `string` \| `null` | Verified alternate identity, never inferred from a name or phone typed by a user. |
| <a id="property-displayname"></a> `displayName?` | `string` \| `null` | Untrusted display name. |
| <a id="property-jid"></a> `jid` | `string` | Phone-number or LID account JID. |
