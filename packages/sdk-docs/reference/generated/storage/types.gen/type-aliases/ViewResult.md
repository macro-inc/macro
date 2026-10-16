# Type Alias: ViewResult

> **ViewResult** = \{ `kind`: `"created"`; `view`: [`DatabaseView`](DatabaseView.md); \} \| \{ `kind`: `"updated"`; `view`: [`DatabaseView`](DatabaseView.md); \} \| \{ `kind`: `"deleted"`; \} \| \{ `kind`: `"card_moved"`; `positions`: [`CardPosition`](CardPosition.md)[]; \}

What happened to a view.

## Union Members

### Type Literal

\{ `kind`: `"created"`; `view`: [`DatabaseView`](DatabaseView.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"created"` | - |
| `view` | [`DatabaseView`](DatabaseView.md) | The view as stored. |

***

### Type Literal

\{ `kind`: `"updated"`; `view`: [`DatabaseView`](DatabaseView.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"updated"` | - |
| `view` | [`DatabaseView`](DatabaseView.md) | The view as stored. |

***

### Type Literal

\{ `kind`: `"deleted"`; \}

***

### Type Literal

\{ `kind`: `"card_moved"`; `positions`: [`CardPosition`](CardPosition.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `kind` | `"card_moved"` | - |
| `positions` | [`CardPosition`](CardPosition.md)[] | The positions written, the moved card's last. |
