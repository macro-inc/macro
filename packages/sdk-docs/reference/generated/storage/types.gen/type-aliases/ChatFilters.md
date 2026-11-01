# Type Alias: ChatFilters

> **ChatFilters** = \{ `chat_ids?`: `string`[]; `importance?`: `boolean` \| `null`; `notification_filters?`: [`NotificationFilters`](NotificationFilters.md); `owners?`: `string`[]; `project_ids?`: `string`[]; `role?`: `string`[]; \}

The chat filters used to filter down what chats you search over.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-chat_ids"></a> `chat_ids?` | `string`[] | Chat ids to search over. Examples: ['chat1'], ['chat1', 'chat2']. When provided, chat search will only match results on these chats. Empty to search all accessible chats. |
| <a id="property-importance"></a> `importance?` | `boolean` \| `null` | Filter by chat importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. |
| <a id="property-notification_filters"></a> `notification_filters?` | [`NotificationFilters`](NotificationFilters.md) | Filter by chat notification state. |
| <a id="property-owners"></a> `owners?` | `string`[] | Filter by chat owner principal — a user ('macro\|user1@user.com'), a bot ('bot\|<uuid>'), or a team (a bare hyphenated uuid). Examples: ['macro\|user1@user.com'], ['macro\|user1@user.com', 'bot\|0199...']. Empty to search all owners. |
| <a id="property-project_ids"></a> `project_ids?` | `string`[] | A list of project ids to search within. Examples: ['project1']. Empty to ignore project filtering. |
| <a id="property-role"></a> `role?` | `string`[] | Chat message roles to search. Examples: ['user'], ['assistant']. Empty to search all roles. |
