# Type Alias: ResolveRequest

> **ResolveRequest** = \{ `grantedLevel?`: `null` \| [`AccessLevel`](AccessLevel.md); `revision`: `number`; \}

Owner's decision; omission of a granted level means deny.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-grantedlevel"></a> `grantedLevel?` | `null` \| [`AccessLevel`](AccessLevel.md) | - |
| <a id="property-revision"></a> `revision` | `number` | Request revision being reviewed. |
