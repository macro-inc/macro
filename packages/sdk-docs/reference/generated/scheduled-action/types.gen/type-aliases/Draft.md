# Type Alias: Draft

> **Draft** = [`DraftedRoutine`](DraftedRoutine.md) & \{ `outcome`: `"routine"`; \} \| [`DraftedStep`](DraftedStep.md) & \{ `outcome`: `"step"`; \} \| \{ `message`: `string`; `outcome`: `"failed"`; \}

What AI drafted, or why it couldn't.
