# Type Alias: TaskSuggestions

> **TaskSuggestions** = \{ `body?`: `string` \| `null`; `due_date?`: `string` \| `null`; `properties?`: [`InputPropertySuggestion`](InputPropertySuggestion.md)[]; `title?`: `string` \| `null`; \}

Editable fields for task inference, before submission and identity resolution.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `string` \| `null` | Suggested Markdown content or outgoing message body. |
| <a id="property-due_date"></a> `due_date?` | `string` \| `null` | Task deadline as a local ISO date. |
| <a id="property-properties"></a> `properties?` | [`InputPropertySuggestion`](InputPropertySuggestion.md)[] | Display names/values that the client resolves against available task fields. |
| <a id="property-title"></a> `title?` | `string` \| `null` | Suggested note, task, or event title. |
