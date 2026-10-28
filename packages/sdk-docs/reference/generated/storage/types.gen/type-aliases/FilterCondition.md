# Type Alias: FilterCondition

> **FilterCondition** = \{ `column`: `string`; `test`: [`FilterTest`](FilterTest.md); \}

A test of one column's cells.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-column"></a> `column` | `string` | The column tested. |
| <a id="property-test"></a> `test` | [`FilterTest`](FilterTest.md) | What its cell must be. The test's kind must fit the column's type. |
