# Type Alias: UndoChangeResponse

> **UndoChangeResponse** = \{ `outcome`: [`UndoOutcome`](UndoOutcome.md); \}

What undoing a change did.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-outcome"></a> `outcome` | [`UndoOutcome`](UndoOutcome.md) | The outcome: reverted, partly reverted with the cells others changed since left alone, or refused with why and whose change stands in the way. |
