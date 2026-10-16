# Type Alias: TaskAssignedMetadata

> **TaskAssignedMetadata** = \{ `assignedBy`: `string`; `senderProfilePictureUrl?`: `string` \| `null`; `subType?`: `null` \| [`NotificationDocumentSubType`](NotificationDocumentSubType.md); `taskId`: `string`; `taskName?`: `string` \| `null`; \}

Metadata for when a user is assigned to a task

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-assignedby"></a> `assignedBy` | `string` | The user who assigned the task |
| <a id="property-senderprofilepictureurl"></a> `senderProfilePictureUrl?` | `string` \| `null` | - |
| <a id="property-subtype"></a> `subType?` | `null` \| [`NotificationDocumentSubType`](NotificationDocumentSubType.md) | - |
| <a id="property-taskid"></a> `taskId` | `string` | The unique identifier of the task |
| <a id="property-taskname"></a> `taskName?` | `string` \| `null` | The name of the task (optional) |
