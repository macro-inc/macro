# Type Alias: EntityAccessGrantedMetadata

> **EntityAccessGrantedMetadata** = \{ `accessLevel`: [`RequestedAccessLevel`](RequestedAccessLevel.md); `entityName`: `string`; `fileType?`: `string` \| `null`; `requestId`: `string`; `revision`: `number`; \}

A person granted you access to a shared entity.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-accesslevel"></a> `accessLevel` | [`RequestedAccessLevel`](RequestedAccessLevel.md) | Requested or granted permission. |
| <a id="property-entityname"></a> `entityName` | `string` | Shared item's name. |
| <a id="property-filetype"></a> `fileType?` | `string` \| `null` | Document file type for routing. |
| <a id="property-requestid"></a> `requestId` | `string` | Stable request identity. |
| <a id="property-revision"></a> `revision` | `number` | Revision that generated this notification. |
