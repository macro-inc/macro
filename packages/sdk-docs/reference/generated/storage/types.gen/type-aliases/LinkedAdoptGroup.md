# Type Alias: LinkedAdoptGroup

> **LinkedAdoptGroup** = \{ `group_jid`: `string`; `name?`: `string` \| `null`; `team_id?`: `string` \| `null`; \}

Explicit adoption request; the account is selected server-side.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-group_jid"></a> `group_jid` | `string` | Group the requester's account has joined. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Name for a newly created group entity; defaults to the group subject. |
| <a id="property-team_id"></a> `team_id?` | `string` \| `null` | Destination workspace. |
