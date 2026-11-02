# Type Alias: TaskSearchSuggestions

> **TaskSearchSuggestions** = \{ `assignees`: `string`[]; `created_by`: `string`[]; `priority`: `string`[]; `query?`: `string` \| `null`; `status`: `string`[]; \}

Task facets match the shared search editor; assignee and creator are distinct.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-assignees"></a> `assignees` | `string`[] | Assigned people's names or supplied addresses. |
| <a id="property-created_by"></a> `created_by` | `string`[] | Task creators' names or supplied addresses. |
| <a id="property-priority"></a> `priority` | `string`[] | Priority display values for client-side option resolution. |
| <a id="property-query"></a> `query?` | `string` \| `null` | Remaining keyword phrase. |
| <a id="property-status"></a> `status` | `string`[] | Status display values for client-side option resolution. |
