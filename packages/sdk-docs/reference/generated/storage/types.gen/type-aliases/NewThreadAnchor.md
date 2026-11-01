# Type Alias: NewThreadAnchor

> **NewThreadAnchor** = \{ `mark_id`: `string`; `marked_text?`: `string` \| `null`; `type`: `"markdown"`; \} \| \{ `anchor_id`: `string`; `type`: `"pdf_highlight"`; \} \| \{ `anchor_id`: `string`; `height_pct`: `number`; `page`: `number`; `type`: `"pdf_placeable"`; `width_pct`: `number`; `x_pct`: `number`; `y_pct`: `number`; \} \| \{ `range`: `string`; `sheetId`: `string`; `sheetName`: `string`; `type`: `"spreadsheet"`; \} \| \{ `nodeId?`: `string` \| `null`; `pageId`: `string`; `type`: `"fig"`; `x`: `number`; `y`: `number`; \}

Location supplied when creating a document discussion.

## Union Members

### Type Literal

\{ `mark_id`: `string`; `marked_text?`: `string` \| `null`; `type`: `"markdown"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `mark_id` | `string` | Serialized mark identifier. |
| `marked_text?` | `string` \| `null` | The document text the mark covers, captured by the editor as the comment is written. Trimmed and bounded before it is stored, so an oversized or whitespace-only claim cannot reach the thread row. |
| `type` | `"markdown"` | - |

***

### Type Literal

\{ `anchor_id`: `string`; `type`: `"pdf_highlight"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `anchor_id` | `string` | Highlight annotation identifier. |
| `type` | `"pdf_highlight"` | - |

***

### Type Literal

\{ `anchor_id`: `string`; `height_pct`: `number`; `page`: `number`; `type`: `"pdf_placeable"`; `width_pct`: `number`; `x_pct`: `number`; `y_pct`: `number`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `anchor_id` | `string` | Client-generated annotation identifier used by optimistic rendering. |
| `height_pct` | `number` | Height as a fraction of the page height. |
| `page` | `number` | PDF page number. |
| `type` | `"pdf_placeable"` | - |
| `width_pct` | `number` | Width as a fraction of the page width. |
| `x_pct` | `number` | Horizontal position as a fraction of the page width. |
| `y_pct` | `number` | Vertical position as a fraction of the page height. |

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
| `nodeId?` | `string` \| `null` | Layer the pin follows; absent or null for a pin on the bare canvas. |
| `pageId` | `string` | Page (canvas) the pin is on. |
| `type` | `"fig"` | - |
| `x` | `number` | Horizontal offset from the layer's origin, or the page's when the pin is on no layer, in design units. |
| `y` | `number` | Vertical offset, measured like `x`. |
