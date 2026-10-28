# Type Alias: RequestedLayout

> **RequestedLayout** = \{ `columns`: [`ViewColumn`](ViewColumn.md)[]; `kind`: `"table"`; \} \| \{ `cardFields`: `string`[]; `groupBy`: `string`; `hideEmptyLanes`: `boolean`; `kind`: `"board"`; `lanes`: [`Lane`](Lane.md)[]; `title?`: `string`; \} \| \{ `barFields?`: `string`[]; `colorBy`: `string` \| `null`; `groupBy`: `string` \| `null`; `kind`: `"timeline"`; `range`: `string`; `title?`: `string`; \}

A layout as an op asks for it: a board or timeline may leave its title
out.

## Union Members

### Type Literal

\{ `columns`: [`ViewColumn`](ViewColumn.md)[]; `kind`: `"table"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `columns` | [`ViewColumn`](ViewColumn.md)[] | How columns show, in display order. A column left out shows after the listed ones, in the table's order. |
| `kind` | `"table"` | - |

***

### Type Literal

\{ `cardFields`: `string`[]; `groupBy`: `string`; `hideEmptyLanes`: `boolean`; `kind`: `"board"`; `lanes`: [`Lane`](Lane.md)[]; `title?`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `cardFields` | `string`[] | The columns a card shows under its title, in order. |
| `groupBy` | `string` | The single-select or single-person column whose values are the lanes. |
| `hideEmptyLanes` | `boolean` | Whether a lane with no cards is hidden. |
| `kind` | `"board"` | - |
| `lanes` | [`Lane`](Lane.md)[] | How lanes show, in display order. |
| `title?` | `string` | The column a card is titled by. Left out, a board keeps the title it has, and a new board takes the table's first column. |

***

### Type Literal

\{ `barFields?`: `string`[]; `colorBy`: `string` \| `null`; `groupBy`: `string` \| `null`; `kind`: `"timeline"`; `range`: `string`; `title?`: `string`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `barFields?` | `string`[] | The columns a bar shows after its title, in order. |
| `colorBy` | `string` \| `null` | The select or tag column whose options color the bars, if any. |
| `groupBy` | `string` \| `null` | The single-select or single-person column grouping the bars, if any. |
| `kind` | `"timeline"` | - |
| `range` | `string` | The date-range column whose cells are the bars. |
| `title?` | `string` | The column a bar is labelled by. Left out, a timeline keeps the title it has, and a new timeline takes the table's first column. |
