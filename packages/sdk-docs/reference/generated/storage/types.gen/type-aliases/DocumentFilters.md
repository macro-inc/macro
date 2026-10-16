# Type Alias: DocumentFilters

> **DocumentFilters** = \{ `document_ids?`: `string`[]; `file_types?`: `string`[]; `importance?`: `boolean` \| `null`; `is_email_attachment?`: `boolean` \| `null`; `notification_filters?`: [`NotificationFilters`](NotificationFilters.md); `owners?`: `string`[]; `project_ids?`: `string`[]; `sub_types?`: `string`[]; `task_filters?`: [`TaskFilters`](TaskFilters.md); \}

The document filters used to filter down what documents you search over.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-document_ids"></a> `document_ids?` | `string`[] | Document ids to search over. Examples: ['doc1'], ['doc1', 'doc2']. Empty to search all accessible documents. |
| <a id="property-file_types"></a> `file_types?` | `string`[] | Document file types to search. Examples: ['pdf'], ['md', 'txt']. Empty to search all file types. |
| <a id="property-importance"></a> `importance?` | `boolean` \| `null` | Filter by document importance. None to ignore, true to pass through (no clause), false to short-circuit and return nothing. |
| <a id="property-is_email_attachment"></a> `is_email_attachment?` | `boolean` \| `null` | Filter by email attachment status. true = only email attachments, false = only non-email attachments, None = both. |
| <a id="property-notification_filters"></a> `notification_filters?` | [`NotificationFilters`](NotificationFilters.md) | Filter by document notification state. |
| <a id="property-owners"></a> `owners?` | `string`[] | Filter by document owner principal — a user ('macro\|user1@user.com'), a bot ('bot\|<uuid>'), or a team (a bare hyphenated uuid). Examples: ['macro\|user1@user.com'], ['macro\|user1@user.com', 'bot\|0199...']. Empty to search all owners. |
| <a id="property-project_ids"></a> `project_ids?` | `string`[] | A list of project ids to search within. Examples: ['project1']. filtering. Empty to ignore project filtering. |
| <a id="property-sub_types"></a> `sub_types?` | `string`[] | Filter by document sub type. Examples: ['task']. Empty to search all sub types. |
| <a id="property-task_filters"></a> `task_filters?` | [`TaskFilters`](TaskFilters.md) | Task-specific filters that only apply to task subtype documents. |
