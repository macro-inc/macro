# Type Alias: SimpleDocumentSearchResponseBaseItemHumanReadableTimestamp

> **SimpleDocumentSearchResponseBaseItemHumanReadableTimestamp** = \{ `document_id`: `string`; `document_name`: `string`; `file_type`: `string`; `highlight`: [`SearchHighlight`](SearchHighlight.md); `node_id`: `string`; `owner_id`: `string`; `raw_content?`: `string` \| `null`; `updated_at`: `string`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-document_id"></a> `document_id` | `string` | The document id |
| <a id="property-document_name"></a> `document_name` | `string` | The document name |
| <a id="property-file_type"></a> `file_type` | `string` | The file type |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | The highlights on the document |
| <a id="property-node_id"></a> `node_id` | `string` | The node id |
| <a id="property-owner_id"></a> `owner_id` | `string` | The owner id |
| <a id="property-raw_content"></a> `raw_content?` | `string` \| `null` | The raw content of the document |
| <a id="property-updated_at"></a> `updated_at` | `string` | DateTime<Utc> ts_seconds deserialization + RFC3339 serialization |
