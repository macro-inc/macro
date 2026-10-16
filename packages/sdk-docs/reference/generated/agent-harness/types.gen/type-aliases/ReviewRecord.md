# Type Alias: ReviewRecord

> **ReviewRecord** = \{ `executionId?`: `null` \| [`ExecutionId`](ExecutionId.md); `id`: [`ReviewId`](ReviewId.md); `items`: [`ReviewItem`](ReviewItem.md)[]; `kind`: [`ReviewKind`](ReviewKind.md); `notificationAttemptAt?`: `number` \| `null`; `notificationId?`: `string` \| `null`; `presentedAt?`: `number` \| `null`; `revision`: `number`; `sessionId`: `string`; `title`: `string`; `updatedAt`: `number`; \}

Full UI record, fetched outside the model context.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-executionid"></a> `executionId?` | `null` \| [`ExecutionId`](ExecutionId.md) | - |
| <a id="property-id"></a> `id` | [`ReviewId`](ReviewId.md) | Review identity. |
| <a id="property-items"></a> `items` | [`ReviewItem`](ReviewItem.md)[] | Drafts and per-item outcomes. |
| <a id="property-kind"></a> `kind` | [`ReviewKind`](ReviewKind.md) | Component kind. |
| <a id="property-notificationattemptat"></a> `notificationAttemptAt?` | `number` \| `null` | Most recent delivery claim, allowing retry after a replica stops. |
| <a id="property-notificationid"></a> `notificationId?` | `string` \| `null` | Stable queued-action identity until the outcome has reached the session. A failed notification may be retried without repeating external actions. |
| <a id="property-presentedat"></a> `presentedAt?` | `number` \| `null` | Durable presentation acknowledgment, separate from user decisions. |
| <a id="property-revision"></a> `revision` | `number` | Compare-and-swap revision for edits and submissions. |
| <a id="property-sessionid"></a> `sessionId` | `string` | Owning session. |
| <a id="property-title"></a> `title` | `string` | Stack label. |
| <a id="property-updatedat"></a> `updatedAt` | `number` | Milliseconds since epoch of the last state change. |
