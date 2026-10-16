# Type Alias: DocumentTeamShareResponse

> **DocumentTeamShareResponse** = \{ `sharedWithTeam`: `boolean`; `teamId?`: `string` \| `null`; \}

The team-share state of a document. The team is resolved from the document
owner's team membership.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-sharedwithteam"></a> `sharedWithTeam` | `boolean` | Whether explicit team sharing is enabled; inherited team access does not count. |
| <a id="property-teamid"></a> `teamId?` | `string` \| `null` | The owner's team the document is (or would be) shared with. `None` when the owner does not belong to a team. |
