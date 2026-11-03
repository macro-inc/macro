# Type Alias: DocumentEditsApplied

> **DocumentEditsApplied** = \{ `applied`: `number`; `changedBlockIds`: `string`[]; `revision`: `string`; \}

A committed batch.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-applied"></a> `applied` | `number` | Number of ops applied. |
| <a id="property-changedblockids"></a> `changedBlockIds` | `string`[] | Durable ids of the blocks the batch touched. |
| <a id="property-revision"></a> `revision` | `string` | The document's version after the batch, as sync-service encodes it. |
