# Type Alias: ResultColumn

> **ResultColumn** = \{ `kind`: [`SqlOutcomeKind`](SqlOutcomeKind.md); `name`: `string`; `options?`: [`SqlSelectOption`](SqlSelectOption.md)[]; `relatedTable?`: `null` \| [`TableId`](TableId.md); `target?`: `null` \| [`SqlEntityKind`](SqlEntityKind.md); \}

One result column, with what its cells mean.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-kind"></a> `kind` | [`SqlOutcomeKind`](SqlOutcomeKind.md) | What its cells hold. |
| <a id="property-name"></a> `name` | `string` | The name or alias the statement gave it. |
| <a id="property-options"></a> `options?` | [`SqlSelectOption`](SqlSelectOption.md)[] | For a select column, its options: its cells hold their ids. |
| <a id="property-relatedtable"></a> `relatedTable?` | `null` \| [`TableId`](TableId.md) | - |
| <a id="property-target"></a> `target?` | `null` \| [`SqlEntityKind`](SqlEntityKind.md) | - |
