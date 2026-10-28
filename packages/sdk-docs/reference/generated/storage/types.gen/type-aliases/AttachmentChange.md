# Type Alias: AttachmentChange

> **AttachmentChange** = \{ `type`: `"preserve"`; \} \| \{ `type`: `"replace"`; `value`: [`NewAttachment`](NewAttachment.md)[]; \} \| \{ `type`: `"delta"`; `value`: \{ `add`: [`NewAttachment`](NewAttachment.md)[]; `remove`: `string`[]; \}; \}

Attachment changes interpreted by the common command boundary.

## Union Members

### Type Literal

\{ `type`: `"preserve"`; \}

***

### Type Literal

\{ `type`: `"replace"`; `value`: [`NewAttachment`](NewAttachment.md)[]; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"replace"` | - |
| `value` | [`NewAttachment`](NewAttachment.md)[] | Replace all attachments. |

***

### Type Literal

\{ `type`: `"delta"`; `value`: \{ `add`: [`NewAttachment`](NewAttachment.md)[]; `remove`: `string`[]; \}; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `type` | `"delta"` | - |
| `value` | \{ `add`: [`NewAttachment`](NewAttachment.md)[]; `remove`: `string`[]; \} | Remove stored attachment identities and append new references. |
| `value.add` | [`NewAttachment`](NewAttachment.md)[] | New attachments to append. |
| `value.remove` | `string`[] | Existing attachment UUIDs to remove. |
