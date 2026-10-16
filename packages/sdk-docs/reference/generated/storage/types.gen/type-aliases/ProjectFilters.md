# Type Alias: ProjectFilters

> **ProjectFilters** = \{ `importance?`: `boolean` \| `null`; `include_root?`: `boolean`; `notification_filters?`: [`NotificationFilters`](NotificationFilters.md); `owners?`: `string`[]; `project_ids?`: `string`[]; \}

The project filters used to filter down what projects you search over.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-importance"></a> `importance?` | `boolean` \| `null` | Filter by project importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. |
| <a id="property-include_root"></a> `include_root?` | `boolean` | When true, `project_ids` also matches the projects themselves in addition to their children. |
| <a id="property-notification_filters"></a> `notification_filters?` | [`NotificationFilters`](NotificationFilters.md) | Filter by project notification state. |
| <a id="property-owners"></a> `owners?` | `string`[] | Filter by project owner principal — a user ('macro\|user1@user.com'), a bot ('bot\|<uuid>'), or a team (a bare hyphenated uuid). Examples: ['macro\|user1@user.com'], ['macro\|user1@user.com', 'bot\|0199...']. Empty to search all owners. |
| <a id="property-project_ids"></a> `project_ids?` | `string`[] | Project IDs to search within. Examples: ['project1']. Empty to search all accessible projects. By default matches children of these projects; set `include_root` to also match the projects themselves. |
