# Type Alias: MoneyColumn

> **MoneyColumn** = \{ `amount`: `string`; `currency`: `string`; \}

Stable association between a numeric amount and its per-row denomination.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-amount"></a> `amount` | `string` | The numeric column; renaming it preserves this association. |
| <a id="property-currency"></a> `currency` | `string` | The select column containing the currency code. |
