# Type Alias: AccessRequestState

> **AccessRequestState** = \{ `accessLevel?`: `null` \| [`AccessLevel`](AccessLevel.md); `canReview`: `boolean`; `mine?`: `null` \| [`AccessRequest`](AccessRequest.md); `nextOffset?`: `number` \| `null`; `owner?`: `string` \| `null`; `pendingCount`: `number`; `requests`: [`AccessRequest`](AccessRequest.md)[]; `supportedLevels`: [`AccessLevel`](AccessLevel.md)[]; \}

Share state visible to one authenticated viewer.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accesslevel"></a> `accessLevel?` | `null` \| [`AccessLevel`](AccessLevel.md) | - |
| <a id="property-canreview"></a> `canReview` | `boolean` | Whether this viewer can resolve requests and manage direct grants. |
| <a id="property-mine"></a> `mine?` | `null` \| [`AccessRequest`](AccessRequest.md) | - |
| <a id="property-nextoffset"></a> `nextOffset?` | `number` \| `null` | Next page offset, absent at the end. |
| <a id="property-owner"></a> `owner?` | `string` \| `null` | Recorded owner principal, visible to reviewers and callers with access. |
| <a id="property-pendingcount"></a> `pendingCount` | `number` | Total outstanding requests, for the Share badge. |
| <a id="property-requests"></a> `requests` | [`AccessRequest`](AccessRequest.md)[] | Reviewer-only pending page, oldest first. |
| <a id="property-supportedlevels"></a> `supportedLevels` | [`AccessLevel`](AccessLevel.md)[] | Permitted access choices for this surface. |
