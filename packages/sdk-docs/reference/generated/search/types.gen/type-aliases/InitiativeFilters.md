# Type Alias: InitiativeFilters

> **InitiativeFilters** = \{ `due_after?`: `string` \| `null`; `due_before?`: `string` \| `null`; `include?`: `boolean`; `initiative_ids?`: `string`[]; `name?`: `string` \| `null`; `owners?`: `string`[]; \}

Filters for initiatives.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-due_after"></a> `due_after?` | `string` \| `null` | Inclusive lower due-date bound. |
| <a id="property-due_before"></a> `due_before?` | `string` \| `null` | Inclusive upper due-date bound. |
| <a id="property-include"></a> `include?` | `boolean` | Opt this query into initiatives at all. Initiatives are off by default — see [`crate::ast::initiative::InitiativeLiteral::Include`]. Asking for specific `initiative_ids` or `owners` also opts in. |
| <a id="property-initiative_ids"></a> `initiative_ids?` | `string`[] | Initiative ids to filter by. Empty to include all accessible initiatives. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Case-insensitive name substring. |
| <a id="property-owners"></a> `owners?` | `string`[] | Filter by initiative owner principal — a user ('macro\|user1@user.com'), a bot ('bot\|<uuid>'), or a team (a bare hyphenated uuid). Empty to include every owner. |
