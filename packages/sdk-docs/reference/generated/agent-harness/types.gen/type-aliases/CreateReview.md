# Type Alias: CreateReview

> **CreateReview** = \{\[`key`: `string`\]: `unknown`; \} & \{ `executionId?`: `null` \| [`ExecutionId`](ExecutionId.md); `title`: `string`; \}

Review creation. Decoding it validates every draft; creating a review only
presents the drafts, and the account holder acts separately.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `executionId?` | `null` \| [`ExecutionId`](ExecutionId.md) | - |
| `title` | `string` | Stack label. |
