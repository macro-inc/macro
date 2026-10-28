# Type Alias: NewView

> **NewView** = \{ `layout`: [`RequestedLayout`](RequestedLayout.md); `name`: `string`; `query?`: [`ViewQuery`](ViewQuery.md); \}

A view's contents as an op creates it; the server gives it its id,
position and times.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-layout"></a> `layout` | [`RequestedLayout`](RequestedLayout.md) | How it draws them; a board left without a card title gets the table's first column. |
| <a id="property-name"></a> `name` | `string` | Its name. |
| <a id="property-query"></a> `query?` | [`ViewQuery`](ViewQuery.md) | Which rows it shows, in what order. |
