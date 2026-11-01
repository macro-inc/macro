# Type Alias: DocumentTopicEvent

> **DocumentTopicEvent** = \{ `event_type`: `"document.created"`; `metadata`: [`DocumentCreatedMetadata`](DocumentCreatedMetadata.md); \} \| \{ `event_type`: `"document.updated"`; `metadata`: [`DocumentUpdatedMetadata`](DocumentUpdatedMetadata.md); \} \| \{ `event_type`: `"document.deleted"`; `metadata`: [`DocumentDeletedMetadata`](DocumentDeletedMetadata.md); \} \| \{ `event_type`: `"document.content_uploaded"`; `metadata`: [`DocumentContentUploadedMetadata`](DocumentContentUploadedMetadata.md); \} \| \{ `event_type`: `"document.sync_content_updated"`; `metadata`: [`DocumentSyncContentUpdatedMetadata`](DocumentSyncContentUpdatedMetadata.md); \} \| \{ `event_type`: `"document.purged"`; `metadata`: [`DocumentPurgedMetadata`](DocumentPurgedMetadata.md); \} \| \{ `event_type`: `"document.copied"`; `metadata`: [`DocumentCopiedMetadata`](DocumentCopiedMetadata.md); \} \| \{ `event_type`: `"document.interaction"`; `metadata`: [`DocumentInteractionMetadata`](DocumentInteractionMetadata.md); \}

Events that can be published to [`MacroDocumentsTopic`].

## Union Members

### Type Literal

\{ `event_type`: `"document.created"`; `metadata`: [`DocumentCreatedMetadata`](DocumentCreatedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"document.created"` | - |
| `metadata` | [`DocumentCreatedMetadata`](DocumentCreatedMetadata.md) | A document was created. |

***

### Type Literal

\{ `event_type`: `"document.updated"`; `metadata`: [`DocumentUpdatedMetadata`](DocumentUpdatedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"document.updated"` | - |
| `metadata` | [`DocumentUpdatedMetadata`](DocumentUpdatedMetadata.md) | A document's metadata / permissions were updated. |

***

### Type Literal

\{ `event_type`: `"document.deleted"`; `metadata`: [`DocumentDeletedMetadata`](DocumentDeletedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"document.deleted"` | - |
| `metadata` | [`DocumentDeletedMetadata`](DocumentDeletedMetadata.md) | A document was soft-deleted. |

***

### Type Literal

\{ `event_type`: `"document.content_uploaded"`; `metadata`: [`DocumentContentUploadedMetadata`](DocumentContentUploadedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"document.content_uploaded"` | - |
| `metadata` | [`DocumentContentUploadedMetadata`](DocumentContentUploadedMetadata.md) | The document's stored bytes were (re)written to S3. |

***

### Type Literal

\{ `event_type`: `"document.sync_content_updated"`; `metadata`: [`DocumentSyncContentUpdatedMetadata`](DocumentSyncContentUpdatedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"document.sync_content_updated"` | - |
| `metadata` | [`DocumentSyncContentUpdatedMetadata`](DocumentSyncContentUpdatedMetadata.md) | A live-collab (sync) document's content changed and should be re-extracted. |

***

### Type Literal

\{ `event_type`: `"document.purged"`; `metadata`: [`DocumentPurgedMetadata`](DocumentPurgedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"document.purged"` | - |
| `metadata` | [`DocumentPurgedMetadata`](DocumentPurgedMetadata.md) | The document row was permanently deleted (hard delete). |

***

### Type Literal

\{ `event_type`: `"document.copied"`; `metadata`: [`DocumentCopiedMetadata`](DocumentCopiedMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"document.copied"` | - |
| `metadata` | [`DocumentCopiedMetadata`](DocumentCopiedMetadata.md) | A document was copied. |

***

### Type Literal

\{ `event_type`: `"document.interaction"`; `metadata`: [`DocumentInteractionMetadata`](DocumentInteractionMetadata.md); \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `event_type` | `"document.interaction"` | - |
| `metadata` | [`DocumentInteractionMetadata`](DocumentInteractionMetadata.md) | A peer joined, left, or a periodic save occurred. |
