# Type Alias: PutCursorDefaultModelRequest

> **PutCursorDefaultModelRequest** = \{ `modelId?`: `string` \| `null`; \}

The model the user chose for their sessions.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-modelid"></a> `modelId?` | `string` \| `null` | A Cursor model id (e.g. `grok-4.6`), or `null` to clear the choice and fall back to the deployment default. |
