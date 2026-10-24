# Type Alias: LinkedCapabilities

> **LinkedCapabilities** = \{ `attachment_limit_bytes`: `number`; `attachment_types`: `string`[]; `max_attachments`: `number`; `mutation_window_seconds`: `number`; `mutations`: [`LinkedMutation`](LinkedMutation.md)[]; `text_limit_bytes`: `number`; \}

Operations implemented for linked groups, independent of current permission.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-attachment_limit_bytes"></a> `attachment_limit_bytes` | `number` | Largest attachment in bytes. |
| <a id="property-attachment_types"></a> `attachment_types` | `string`[] | Supported attachment MIME types. |
| <a id="property-max_attachments"></a> `max_attachments` | `number` | Attachments per send. |
| <a id="property-mutation_window_seconds"></a> `mutation_window_seconds` | `number` | Edits and deletes are offered this long after sending. |
| <a id="property-mutations"></a> `mutations` | [`LinkedMutation`](LinkedMutation.md)[] | Supported message operations. |
| <a id="property-text_limit_bytes"></a> `text_limit_bytes` | `number` | Maximum UTF-8 bytes per text send. |
