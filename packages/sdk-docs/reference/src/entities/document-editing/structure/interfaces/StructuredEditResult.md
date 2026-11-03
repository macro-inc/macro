# Interface: StructuredEditResult

What a committed structured edit did.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-applied"></a> `applied` | `number` | How many ops were applied. |
| <a id="property-changedblocks"></a> `changedBlocks` | `string`[] | Durable ids of the blocks the ops changed or created. |
| <a id="property-revision"></a> `revision` | `string` | The document's version after the edit (base64 Loro version vector). |
