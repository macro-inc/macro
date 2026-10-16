# Type Alias: FileSystemNodeWithIds

> **FileSystemNodeWithIds** = \{ `document_id`: `string`; `item`: [`FolderItem`](FolderItem.md); `type`: `"file"`; \} \| \{ `content`: \{\[`key`: `string`\]: `FileSystemNodeWithIds`; \}; `project_id`: `string`; `type`: `"folder"`; \}
