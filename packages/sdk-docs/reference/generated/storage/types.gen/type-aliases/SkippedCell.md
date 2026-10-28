# Type Alias: SkippedCell

> **SkippedCell** = \{ `by`: `string` \| `null`; `column`: `string`; `row`: `string`; \}

A cell an undo left alone, because someone changed it after the change
being undone.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-by"></a> `by` | `string` \| `null` | Who changed it since, from the journal; `null` when unknown. |
| <a id="property-column"></a> `column` | `string` | The column. |
| <a id="property-row"></a> `row` | `string` | The row. |
