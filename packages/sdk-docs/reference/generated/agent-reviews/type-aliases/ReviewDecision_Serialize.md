# Type Alias: ReviewDecision\_Serialize

> **ReviewDecision\_Serialize** = \{ `action`: `"edit"`; `draft`: [`ReviewDraft_Serialize`](ReviewDraft_Serialize.md); `item`: `string`; `revision`: `number`; \} & \{ `items?`: `never`; \} \| \{ `action`: `"submit"`; `items`: `string`[]; `revision`: `number`; \} & \{ `draft?`: `never`; `item?`: `never`; \} \| \{ `action`: `"dismiss"`; `items`: `string`[]; `revision`: `number`; \} & \{ `draft?`: `never`; `item?`: `never`; \}

One atomic user decision against the displayed revision.
