# Type Alias: DraftRequest

> **DraftRequest** = \{ `description`: `string`; `type`: `"routine"`; \} \| \{ `description`: `string`; `kind?`: `null` \| [`StepKind`](StepKind.md); `routine`: [`RoutineSoFar`](RoutineSoFar.md); `type`: `"add_step"`; \} \| \{ `index`: `number`; `instruction`: `string`; `routine`: [`RoutineSoFar`](RoutineSoFar.md); `type`: `"change_step"`; \}

What to draft.
