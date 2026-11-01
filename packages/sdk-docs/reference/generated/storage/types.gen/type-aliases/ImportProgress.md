# Type Alias: ImportProgress

> **ImportProgress** = \{ `conversations`: [`ConversationProgress`](ConversationProgress.md)[]; `createdAt`: `string`; `includeMessageHistory`: `boolean`; `jobId`: [`JobId`](JobId.md); `limits`: [`ImportLimits`](ImportLimits.md); `registrationClosedAt?`: `string` \| `null`; `revision`: `number`; `source`: [`SourceIdentity`](SourceIdentity.md); `status`: [`JobStatus`](JobStatus.md); `updatedAt`: `string`; `usersVerified`: `boolean`; \}

Common receipt returned by create, completion, finalize, cancel and progress.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-conversations"></a> `conversations` | [`ConversationProgress`](ConversationProgress.md)[] | All selected conversations, bounded by the create limit. |
| <a id="property-createdat"></a> `createdAt` | `string` | Persisted creation time, also the final historical-time fallback. |
| <a id="property-includemessagehistory"></a> `includeMessageHistory` | `boolean` | Immutable history option confirmed when creating this job. |
| <a id="property-jobid"></a> `jobId` | [`JobId`](JobId.md) | Stable job identity. |
| <a id="property-limits"></a> `limits` | [`ImportLimits`](ImportLimits.md) | Server bounds for staging and registration. |
| <a id="property-registrationclosedat"></a> `registrationClosedAt?` | `string` \| `null` | Registration closure time; cancellation also closes registration. |
| <a id="property-revision"></a> `revision` | `number` | Monotonic job revision for polling/websocket invalidation. |
| <a id="property-source"></a> `source` | [`SourceIdentity`](SourceIdentity.md) | Immutable source confirmation from this job, not the current team binding. |
| <a id="property-status"></a> `status` | [`JobStatus`](JobStatus.md) | Durable job lifecycle. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | Last durable lifecycle/progress update. |
| <a id="property-usersverified"></a> `usersVerified` | `boolean` | Whether users metadata is verified and pinned. |
