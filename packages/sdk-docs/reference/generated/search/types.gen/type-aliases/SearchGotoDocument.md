# Type Alias: SearchGotoDocument

> **SearchGotoDocument** = \{ `node_id`: `string`; `raw_content?`: `string` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-node_id"></a> `node_id` | `string` | The node id of the document This can be a stringified page number 0-indexed for pdf/docx files, or it can be a unique id that is used in lexical for markdown files. |
| <a id="property-raw_content"></a> `raw_content?` | `string` \| `null` | The raw content of the document |
