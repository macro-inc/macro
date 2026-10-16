# Type Alias: NotificationDocumentSubType

> **NotificationDocumentSubType** = \{ `type`: `"task"`; \} \| \{ `type`: `"snippet"`; \} \| \{ `type`: `"skill"`; \} \| \{ `type`: `"initiative_description"`; \}

The sub type of a document in a notification.
Serializes as `{ "type": "task" }` matching the storage service pattern.
