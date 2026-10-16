# Type Alias: DocumentPreviewDataSubType

> **DocumentPreviewDataSubType** = \{ `is_completed`: `boolean`; `type`: `"task"`; \} \| \{ `type`: `"snippet"`; \} \| \{ `type`: `"skill"`; \} \| \{ `type`: `"initiative_description"`; \}

The sub type of a document preview with associated properties.
Task-related properties are encoded within the variant to ensure valid states.

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
