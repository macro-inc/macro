# Type Alias: LinearIssueMeta

> **LinearIssueMeta** = \{ `assignee?`: `string` \| `null`; `assignee_email?`: `string` \| `null`; `description?`: `string` \| `null`; `due_date?`: `string` \| `null`; `identifier?`: `string` \| `null`; `priority?`: `string` \| `null`; `status?`: `string` \| `null`; `title`: `string`; `url?`: `string` \| `null`; \}

Metadata for one staged Linear issue.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-assignee"></a> `assignee?` | `string` \| `null` | Assignee display name as Linear reports it. |
| <a id="property-assignee_email"></a> `assignee_email?` | `string` \| `null` | Assignee email, when Linear exposes it. |
| <a id="property-description"></a> `description?` | `string` \| `null` | Short markdown description. |
| <a id="property-due_date"></a> `due_date?` | `string` \| `null` | Due date as an ISO date (`YYYY-MM-DD`), when set. |
| <a id="property-identifier"></a> `identifier?` | `string` \| `null` | Linear's human identifier (e.g. `ENG-142`). |
| <a id="property-priority"></a> `priority?` | `string` \| `null` | Priority label (e.g. `Urgent`). |
| <a id="property-status"></a> `status?` | `string` \| `null` | Workflow status name (e.g. `In Progress`). |
| <a id="property-title"></a> `title` | `string` | Issue title. |
| <a id="property-url"></a> `url?` | `string` \| `null` | Deep link back to the issue in Linear. |
