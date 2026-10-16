# Type Alias: AccessRequest

> **AccessRequest** = \{ `createdAt`: `string`; `grantedLevel?`: `null` \| [`AccessLevel`](AccessLevel.md); `id`: `string`; `requestedLevel`: [`AccessLevel`](AccessLevel.md); `requesterId`: `string`; `resolvedAt?`: `string` \| `null`; `retryAfter?`: `string` \| `null`; `revision`: `number`; `status`: [`RequestStatus`](RequestStatus.md); `updatedAt`: `string`; \}

Latest request for one person and one entity.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | Start of this request attempt. |
| <a id="property-grantedlevel"></a> `grantedLevel?` | `null` \| [`AccessLevel`](AccessLevel.md) | - |
| <a id="property-id"></a> `id` | `string` | Stable request identity across revisions. |
| <a id="property-requestedlevel"></a> `requestedLevel` | [`AccessLevel`](AccessLevel.md) | Requested upgrade. |
| <a id="property-requesterid"></a> `requesterId` | `string` | Person requesting access. |
| <a id="property-resolvedat"></a> `resolvedAt?` | `string` \| `null` | When the request stopped being pending. |
| <a id="property-retryafter"></a> `retryAfter?` | `string` \| `null` | Earliest next submission or level change; cancellation preserves this deadline. Submissions wait one minute, denials wait 24 hours, and approval clears it. |
| <a id="property-revision"></a> `revision` | `number` | Optimistic concurrency token. |
| <a id="property-status"></a> `status` | [`RequestStatus`](RequestStatus.md) | Current outcome. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | Most recent change. |
