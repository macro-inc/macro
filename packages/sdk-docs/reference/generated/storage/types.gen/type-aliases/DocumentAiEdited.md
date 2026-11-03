# Type Alias: DocumentAiEdited

> **DocumentAiEdited** = \{ `changedBlockIds`: `string`[]; `revision`: `string`; `summary`: `string`; \}

A completed edit by instructions.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-changedblockids"></a> `changedBlockIds` | `string`[] | Durable ids of the blocks the edit touched. |
| <a id="property-revision"></a> `revision` | `string` | The document's version after the edit, as sync-service encodes it. |
| <a id="property-summary"></a> `summary` | `string` | What changed, in words. |
