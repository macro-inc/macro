# Type Alias: ThreadAnchor

> **ThreadAnchor** = \{ `mark_id`: `string`; `marked_text?`: `string` \| `null`; `type`: `"markdown"`; \} \| \{ `anchor_id`: `string`; `marked_text?`: `string` \| `null`; `type`: `"pdf_highlight"`; \} \| \{ `anchor_id`: `string`; `type`: `"pdf_placeable"`; \} \| \{ `range`: `string`; `sheetId`: `string`; `sheetName`: `string`; `type`: `"spreadsheet"`; \} \| \{ `nodeId?`: `string` \| `null`; `pageId`: `string`; `type`: `"fig"`; `x`: `number`; `y`: `number`; \}

A thread's location within its document. PDF geometry remains annotation-owned.

## Union Members

### Type Literal

\{ `mark_id`: `string`; `marked_text?`: `string` \| `null`; `type`: `"markdown"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `mark_id` | `string` | Mark UUID serialized in the document. |
| `marked_text?` | `string` \| `null` | The marked text as it read when the discussion was created, already trimmed and bounded. Absent on threads created or imported before snapshots were captured: the text a mark covers cannot be recovered from the mark id alone. |
| `type` | `"markdown"` | - |

***

### Type Literal

\{ `anchor_id`: `string`; `marked_text?`: `string` \| `null`; `type`: `"pdf_highlight"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `anchor_id` | `string` | Highlight annotation UUID. |
| `marked_text?` | `string` \| `null` | The text the highlight covers, trimmed and bounded like a markdown snapshot. The highlight owns it and it can be edited there, so it is read from the highlight whenever the thread is, never stored on the thread. Absent when the highlight carries no text. |
| `type` | `"pdf_highlight"` | - |

***

### Type Literal

\{ `anchor_id`: `string`; `type`: `"pdf_placeable"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `anchor_id` | `string` | Placeable annotation UUID. |
| `type` | `"pdf_placeable"` | - |

***

### Type Literal

\{ `range`: `string`; `sheetId`: `string`; `sheetName`: `string`; `type`: `"spreadsheet"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `range` | `string` | A1 cell or range, such as B4 or B4:C9. |
| `sheetId` | `string` | Stable sheet identity within the workbook. |
| `sheetName` | `string` | Sheet name when the discussion was created. |
| `type` | `"spreadsheet"` | - |

***

### Type Literal

\{ `nodeId?`: `string` \| `null`; `pageId`: `string`; `type`: `"fig"`; `x`: `number`; `y`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `nodeId?` | `string` \| `null` | Layer the pin follows; absent for a pin on the bare canvas. |
| `pageId` | `string` | Page (canvas) the pin is on. |
| `type` | `"fig"` | - |
| `x` | `number` | Horizontal offset from the layer's origin, or the page's when the pin is on no layer, in design units. |
| `y` | `number` | Vertical offset, measured like `x`. |
