# Type Alias: DeleteDraftData

> **DeleteDraftData** = \{ `body?`: `never`; `path`: \{ `id`: `string`; \}; `query?`: \{ `draft_generation?`: `number`; \}; `url`: `"/email/drafts/{id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `id`: `string`; \} | - |
| `path.id` | `string` | Draft ID. |
| <a id="property-query"></a> `query?` | \{ `draft_generation?`: `number`; \} | - |
| `query.draft_generation?` | `number` | Generation from the last loaded draft. Legacy clients use zero. |
| <a id="property-url"></a> `url` | `"/email/drafts/{id}"` | - |
