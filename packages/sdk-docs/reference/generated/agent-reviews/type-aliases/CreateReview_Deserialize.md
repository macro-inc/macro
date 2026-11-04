# Type Alias: CreateReview\_Deserialize

> **CreateReview\_Deserialize** = \{ `executionId?`: [`ExecutionId`](ExecutionId.md) \| `null`; `title`: [`ReviewTitle`](ReviewTitle.md); \} & [`ReviewDrafts_Deserialize`](ReviewDrafts_Deserialize.md)

Review creation. Decoding it validates every draft; creating a review only
 presents the drafts, and the account holder acts separately.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `executionId?` | [`ExecutionId`](ExecutionId.md) \| `null` | Optional code execution that prepared these drafts. |
| `title` | [`ReviewTitle`](ReviewTitle.md) | Stack label. |
