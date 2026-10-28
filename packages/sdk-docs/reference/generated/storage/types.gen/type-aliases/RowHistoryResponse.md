# Type Alias: RowHistoryResponse

> **RowHistoryResponse** = \{ `changes`: [`RowHistoryEntry`](RowHistoryEntry.md)[]; \}

A row's history.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-changes"></a> `changes` | [`RowHistoryEntry`](RowHistoryEntry.md)[] | Every committed change that touched the row, newest first: who made it, when, how, and the touched columns' values before and after. |
