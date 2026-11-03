# Type Alias: ExternalChatCapabilities

> **ExternalChatCapabilities** = \{ `attachmentLimitBytes`: `number`; `attachmentTypes`: `string`[]; `maxAttachments`: `number`; `mutations`: [`ExternalChatMutation`](ExternalChatMutation.md)[]; `mutationWindowSeconds`: `number`; `textLimitBytes`: `number`; \}

Operations implemented for a chat, independent of current permission.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachmentlimitbytes"></a> `attachmentLimitBytes` | `number` | Largest attachment in bytes. |
| <a id="property-attachmenttypes"></a> `attachmentTypes` | `string`[] | Supported attachment MIME types. |
| <a id="property-maxattachments"></a> `maxAttachments` | `number` | Attachments per send. |
| <a id="property-mutations"></a> `mutations` | [`ExternalChatMutation`](ExternalChatMutation.md)[] | Supported message operations. |
| <a id="property-mutationwindowseconds"></a> `mutationWindowSeconds` | `number` | Edits and deletes are offered this long after sending. |
| <a id="property-textlimitbytes"></a> `textLimitBytes` | `number` | Maximum UTF-8 bytes per text send. |
