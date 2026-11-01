# Type Alias: UploadFolderStatusUpdate

> **UploadFolderStatusUpdate** = \{ `projectId`: `string`; `requestId`: `string`; `status`: `"completed"`; \} \| \{ `projectId`: `string`; `requestId`: `string`; `status`: `"partially_completed"`; \} \| \{ `requestId`: `string`; `status`: `"failed"`; \} \| \{ `requestId`: `string`; `status`: `"unknown"`; \}
