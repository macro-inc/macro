# Type Alias: UndoOutcome

> **UndoOutcome** = \{ `changes`: [`CommittedChange`](CommittedChange.md)[]; `kind`: `"reverted"`; \} \| \{ `changes`: [`CommittedChange`](CommittedChange.md)[]; `kind`: `"partial"`; `skipped`: [`SkippedCell`](SkippedCell.md)[]; \} \| \{ `by`: `string` \| `null`; `kind`: `"refused"`; `reason`: [`UndoRefusal`](UndoRefusal.md); \}

What undoing a change did.

## Union Members

### Type Literal

\{ `changes`: [`CommittedChange`](CommittedChange.md)[]; `kind`: `"reverted"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `changes` | [`CommittedChange`](CommittedChange.md)[] | The journal's changes the undo made, one per table version; undo one of them to redo. |
| `kind` | `"reverted"` | - |

***

### Type Literal

\{ `changes`: [`CommittedChange`](CommittedChange.md)[]; `kind`: `"partial"`; `skipped`: [`SkippedCell`](SkippedCell.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `changes` | [`CommittedChange`](CommittedChange.md)[] | The journal's changes the undo made. |
| `kind` | `"partial"` | - |
| `skipped` | [`SkippedCell`](SkippedCell.md)[] | The cells left alone, each with who changed it. |

***

### Type Literal

\{ `by`: `string` \| `null`; `kind`: `"refused"`; `reason`: [`UndoRefusal`](UndoRefusal.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `by` | `string` \| `null` | Whose change stands in the way, when one does. |
| `kind` | `"refused"` | - |
| `reason` | [`UndoRefusal`](UndoRefusal.md) | Why. |
