# Type Alias: GetTeamInvitesData

> **GetTeamInvitesData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `team_id?`: `string`; \}; `url`: `"/team/invites"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `team_id?`: `string`; \} | - |
| `query.team_id?` | `string` | The team the caller means to list. Invites are always read from the caller's current team; when this names another team, the request answers 409. |
| <a id="property-url"></a> `url` | `"/team/invites"` | - |
