# Type Alias: ReviewRecord

> **ReviewRecord** = \{ `actingUser?`: `string` \| `null`; `decision?`: `null` \| [`ReviewDecisionContext`](ReviewDecisionContext.md); `executionId?`: `null` \| [`ExecutionId`](ExecutionId.md); `id`: [`ReviewId`](ReviewId.md); `items`: [`ReviewItem`](ReviewItem.md)[]; `kind`: [`ReviewKind`](ReviewKind.md); `presentedAt?`: `number` \| `null`; `revision`: `number`; `sessionId`: `string`; `title`: `string`; `updatedAt`: `number`; \}

Full UI record, fetched outside the model context.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actinguser"></a> `actingUser?` | `string` \| `null` | Account whose email/calendar the drafts use; historical records use the session owner. |
| <a id="property-decision"></a> `decision?` | `null` \| [`ReviewDecisionContext`](ReviewDecisionContext.md) | - |
| <a id="property-executionid"></a> `executionId?` | `null` \| [`ExecutionId`](ExecutionId.md) | - |
| <a id="property-id"></a> `id` | [`ReviewId`](ReviewId.md) | Review identity. |
| <a id="property-items"></a> `items` | [`ReviewItem`](ReviewItem.md)[] | Drafts and per-item outcomes. |
| <a id="property-kind"></a> `kind` | [`ReviewKind`](ReviewKind.md) | Component kind. |
| <a id="property-presentedat"></a> `presentedAt?` | `number` \| `null` | Durable presentation acknowledgment, separate from user decisions. |
| <a id="property-revision"></a> `revision` | `number` | Compare-and-swap revision for edits and submissions. |
| <a id="property-sessionid"></a> `sessionId` | `string` | Owning session. |
| <a id="property-title"></a> `title` | `string` | Stack label. |
| <a id="property-updatedat"></a> `updatedAt` | `number` | Milliseconds since epoch of the last state change. |
