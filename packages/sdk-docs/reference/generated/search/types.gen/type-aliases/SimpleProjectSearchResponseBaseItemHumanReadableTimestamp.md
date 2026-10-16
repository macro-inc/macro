# Type Alias: SimpleProjectSearchResponseBaseItemHumanReadableTimestamp

> **SimpleProjectSearchResponseBaseItemHumanReadableTimestamp** = \{ `created_at`: `string`; `highlight`: [`SearchHighlight`](SearchHighlight.md); `project_id`: `string`; `project_name`: `string`; `updated_at`: `string`; `user_id`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created_at"></a> `created_at` | `string` | DateTime<Utc> ts_seconds deserialization + RFC3339 serialization |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | The highlights on the project |
| <a id="property-project_id"></a> `project_id` | `string` | The project id |
| <a id="property-project_name"></a> `project_name` | `string` | The project name |
| <a id="property-updated_at"></a> `updated_at` | `string` | DateTime<Utc> ts_seconds deserialization + RFC3339 serialization |
| <a id="property-user_id"></a> `user_id` | `string` | The id of the user who created the project |
