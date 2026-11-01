# Type Alias: ClassifyInputRequest

> **ClassifyInputRequest** = \{ `revision`: `number`; `text`: `string`; \}

A draft snapshot. Revisions are opaque to the server and echoed to the client.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-revision"></a> `revision` | `number` | Opaque client revision used to discard stale predictions. |
| <a id="property-text"></a> `text` | `string` | Current draft text to classify without executing it. |
