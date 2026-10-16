# Type Alias: ViewPositionsResponse

> **ViewPositionsResponse** = \{ `positions`: [`CardPosition`](CardPosition.md)[]; \}

Where a board's cards sit.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-positions"></a> `positions` | [`CardPosition`](CardPosition.md)[] | The places of the cards that have one: each card's lane and its key there. Cards without a place show after the placed ones of their lane, oldest first. |
