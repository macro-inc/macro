# Type Alias: ViewLayout

> **ViewLayout** = \{ `columns`: [`ViewColumn`](ViewColumn.md)[]; `kind`: `"table"`; \} \| \{ `cardFields`: `string`[]; `groupBy`: `string`; `hideEmptyLanes`: `boolean`; `kind`: `"board"`; `lanes`: [`Lane`](Lane.md)[]; `title`: `string`; \}

How a view draws its rows.

## Union Members

### Type Literal

\{ `columns`: [`ViewColumn`](ViewColumn.md)[]; `kind`: `"table"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `columns` | [`ViewColumn`](ViewColumn.md)[] | How columns show, in display order. A column left out shows after the listed ones, in the table's order. |
| `kind` | `"table"` | - |

***

### Type Literal

\{ `cardFields`: `string`[]; `groupBy`: `string`; `hideEmptyLanes`: `boolean`; `kind`: `"board"`; `lanes`: [`Lane`](Lane.md)[]; `title`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `cardFields` | `string`[] | The columns a card shows under its title, in order. |
| `groupBy` | `string` | The single-select or single-person column whose values are the lanes; moving a card to another lane sets this column. |
| `hideEmptyLanes` | `boolean` | Whether a lane with no cards is hidden. |
| `kind` | `"board"` | - |
| `lanes` | [`Lane`](Lane.md)[] | How lanes show, in display order. A lane left out shows after the listed ones: the lane of empty cells first, then options in the column's order, or people by id. |
| `title` | `string` | The column a card is titled by, of any type. Removing it titles the cards by the table's first remaining column. |
