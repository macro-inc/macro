# Type Alias: CommittedChange

> **CommittedChange** = \{ `change`: `number`; `table`: `string`; `version`: [`TableVersion`](TableVersion.md); \}

One change a committed batch journaled: a table, the version the batch
produced, and the journal's id for it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-change"></a> `change` | `number` | The journal's id of the change. |
| <a id="property-table"></a> `table` | `string` | The table. |
| <a id="property-version"></a> `version` | [`TableVersion`](TableVersion.md) | The version the batch produced. |
