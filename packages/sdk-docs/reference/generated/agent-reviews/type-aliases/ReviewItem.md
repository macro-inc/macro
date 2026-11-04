# Type Alias: ReviewItem\<Draft, Outcome\>

> **ReviewItem**\<`Draft`, `Outcome`\> = \{ `draft`: `Draft`; `result`: `Outcome` \| `null`; \} & [`ReviewItemState`](ReviewItemState.md)

One editable item and its durable outcome.

## Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-draft"></a> `Draft` |
| <a id="type-parameter-outcome"></a> `Outcome` |

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `draft` | `Draft` | Arguments for the existing composer and action. |
| `result` | `Outcome` \| `null` | The action's confirmed response, never a model assertion. |
