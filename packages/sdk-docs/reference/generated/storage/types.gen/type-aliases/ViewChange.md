# Type Alias: ViewChange

> **ViewChange** = \{ `kind`: `"create"`; `view`: [`NewView`](NewView.md); \} \| \{ `kind`: `"update"`; `layout?`: [`RequestedLayout`](RequestedLayout.md); `name?`: `string`; `query?`: [`ViewQuery`](ViewQuery.md); \} \| \{ `kind`: `"delete"`; \} \| \{ `after?`: `string` \| `null`; `before?`: `string` \| `null`; `kind`: `"move_card"`; `lane`: [`LaneKey`](LaneKey.md); `row`: `string`; \}

A change to one view.

## Union Members

### Type Literal

\{ `kind`: `"create"`; `view`: [`NewView`](NewView.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"create"` | - |
| `view` | [`NewView`](NewView.md) | What it shows and how. |

***

### Type Literal

\{ `kind`: `"update"`; `layout?`: [`RequestedLayout`](RequestedLayout.md); `name?`: `string`; `query?`: [`ViewQuery`](ViewQuery.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"update"` | - |
| `layout?` | [`RequestedLayout`](RequestedLayout.md) | Its new layout. A board grouped by another column forgets where its cards were; a board left without a card title keeps the one it has, or takes the table's first column. |
| `name?` | `string` | Its new name. |
| `query?` | [`ViewQuery`](ViewQuery.md) | Its new query. |

***

### Type Literal

\{ `kind`: `"delete"`; \}

***

### Type Literal

\{ `after?`: `string` \| `null`; `before?`: `string` \| `null`; `kind`: `"move_card"`; `lane`: [`LaneKey`](LaneKey.md); `row`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `after?` | `string` \| `null` | The card that ends up just after it, if any. Given with `before`, it must be the card right after `before`; with neither, the card goes to the end of the lane. |
| `before?` | `string` \| `null` | The card that ends up just before it (it lands right after this one), if any. |
| `kind` | `"move_card"` | - |
| `lane` | [`LaneKey`](LaneKey.md) | The lane it goes to: an option of a select board's column, a person for a board grouped by people, or the lane of empty cells. |
| `row` | `string` | The card's row. |
