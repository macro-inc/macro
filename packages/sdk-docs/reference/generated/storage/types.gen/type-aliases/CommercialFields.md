# Type Alias: CommercialFields

> **CommercialFields** = \{ `money?`: [`MoneyColumn`](MoneyColumn.md)[]; `outcome?`: `string` \| `null`; \}

CRM-owned roles for columns in the reusable table.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-money"></a> `money?` | [`MoneyColumn`](MoneyColumn.md)[] | Monetary fields, each with an independent per-row currency. |
| <a id="property-outcome"></a> `outcome?` | `string` \| `null` | Outcome column, absent only for a pipeline from a pre-migration writer. |
