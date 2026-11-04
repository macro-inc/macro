# Type Alias: ReviewDecision\_Deserialize

> **ReviewDecision\_Deserialize** = \{ `action`: `"edit"`; `draft`: [`ReviewDraft_Deserialize`](ReviewDraft_Deserialize.md); `item`: `string`; `revision`: `number`; \} & \{ `items?`: `never`; \} \| \{ `action`: `"submit"`; `items`: `string`[]; `revision`: `number`; \} & \{ `draft?`: `never`; `item?`: `never`; \} \| \{ `action`: `"dismiss"`; `items`: `string`[]; `revision`: `number`; \} & \{ `draft?`: `never`; `item?`: `never`; \}

One atomic user decision against the displayed revision.
