# Type Alias: InviteToTeamRequest

> **InviteToTeamRequest** = \{ `invites`: [`InviteEntry`](InviteEntry.md)[]; `team_id?`: `string` \| `null`; \}

The request body to invite a user to a team

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-invites"></a> `invites` | [`InviteEntry`](InviteEntry.md)[] | The invites to send, each with an email and tier |
| <a id="property-team_id"></a> `team_id?` | `string` \| `null` | The team the caller means to invite to. Invites always go to the caller's current team; when this names another team, nothing is sent and the request answers 409. |
