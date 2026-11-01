# Type Alias: EntityMessageTypingData

> **EntityMessageTypingData** = \{ `body`: [`TypingInput`](TypingInput.md); `path`: \{ `parent_id`: `string`; `parent_type`: `string`; \}; `query?`: `never`; `url`: `"/messages/{parent_type}/{parent_id}/typing"`; \}

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-body"></a> `body` | [`TypingInput`](TypingInput.md) |
| <a id="property-path"></a> `path` | \{ `parent_id`: `string`; `parent_type`: `string`; \} |
| `path.parent_id` | `string` |
| `path.parent_type` | `string` |
| <a id="property-query"></a> `query?` | `never` |
| <a id="property-url"></a> `url` | `"/messages/{parent_type}/{parent_id}/typing"` |
