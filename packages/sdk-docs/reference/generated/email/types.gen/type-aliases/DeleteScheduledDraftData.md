# Type Alias: DeleteScheduledDraftData

> **DeleteScheduledDraftData** = \{ `body?`: `never`; `path`: \{ `message_id`: `string`; \}; `query?`: \{ `draft_generation?`: `number`; \}; `url`: `"/email/drafts/scheduled/{message_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `message_id`: `string`; \} | - |
| `path.message_id` | `string` | The ID of the draft |
| <a id="property-query"></a> `query?` | \{ `draft_generation?`: `number`; \} | - |
| `query.draft_generation?` | `number` | Generation from the last loaded draft. Legacy clients use zero. |
| <a id="property-url"></a> `url` | `"/email/drafts/scheduled/{message_id}"` | - |
