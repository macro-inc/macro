# Type Alias: RequestAccess

> **RequestAccess** = \{ `requestedLevel`: [`AccessLevel`](AccessLevel.md); `revision?`: `number` \| `null`; \}

Requester submission; an existing pending request requires its revision.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-requestedlevel"></a> `requestedLevel` | [`AccessLevel`](AccessLevel.md) | Desired View, Comment, or Edit permission. |
| <a id="property-revision"></a> `revision?` | `number` \| `null` | Last observed revision; omitted only for the first request. |
