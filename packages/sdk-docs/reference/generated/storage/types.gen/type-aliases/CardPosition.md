# Type Alias: CardPosition

> **CardPosition** = \{ `lane`: [`LaneKey`](LaneKey.md); `position`: `string`; `row`: `string`; \}

Where one card sits on a board: its lane, and its fractional key there.
A card whose row has since moved to another lane has no place until it is
moved again.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-lane"></a> `lane` | [`LaneKey`](LaneKey.md) | The lane. |
| <a id="property-position"></a> `position` | `string` | The card's key in that lane. |
| <a id="property-row"></a> `row` | `string` | The card's row. |
