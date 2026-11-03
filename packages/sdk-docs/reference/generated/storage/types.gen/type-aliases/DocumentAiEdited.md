# Type Alias: DocumentAiEdited

> **DocumentAiEdited** = \{ `changedBlockIds`: `string`[]; `clarification?`: `string` \| `null`; `revision`: `string`; `summary`: `string`; \}

A completed edit by instructions.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-changedblockids"></a> `changedBlockIds` | `string`[] | Durable ids of the blocks the edit touched. |
| <a id="property-clarification"></a> `clarification?` | `string` \| `null` | What the editor needs to know to finish, when it applied part of the edit and stopped; the applied part stays. |
| <a id="property-revision"></a> `revision` | `string` | The document's version after the edit, as sync-service encodes it. |
| <a id="property-summary"></a> `summary` | `string` | What changed, in words. |
