# Type Alias: DatabaseQueryView

> **DatabaseQueryView** = \{ `chart?`: `DatabaseQueryChart` \| `null`; `displayMode?`: `DatabaseQueryDisplayMode`; `height?`: `number` \| `null`; `title?`: `string` \| `null`; \}

Presentation of a saved database question; `null` removes a field. The
 question and its SQL never change here: a new question is a new block.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-chart"></a> `chart?` | `DatabaseQueryChart` \| `null` |
| <a id="property-displaymode"></a> `displayMode?` | `DatabaseQueryDisplayMode` |
| <a id="property-height"></a> `height?` | `number` \| `null` |
| <a id="property-title"></a> `title?` | `string` \| `null` |
