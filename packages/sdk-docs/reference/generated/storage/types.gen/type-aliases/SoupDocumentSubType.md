# Type Alias: SoupDocumentSubType

> **SoupDocumentSubType** = \{ `is_completed`: `boolean`; `type`: `"task"`; \} \| \{ `type`: `"snippet"`; \} \| \{ `type`: `"skill"`; \} \| \{ `type`: `"initiative_description"`; \}

Sub type of a document with associated properties encoded in each variant.
This ensures type-safety: task properties only exist when the document is a task.

## Union Members

### Type Literal

\{ `is_completed`: `boolean`; `type`: `"task"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `is_completed` | `boolean` | Whether the task is completed. True if the Status property is set to "Completed". |
| `type` | `"task"` | - |

***

### Type Literal

\{ `type`: `"snippet"`; \}

***

### Type Literal

\{ `type`: `"skill"`; \}

***

### Type Literal

\{ `type`: `"initiative_description"`; \}
