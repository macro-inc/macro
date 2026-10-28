# Type Alias: DocumentSearchResult

> **DocumentSearchResult** = \{ `highlight`: [`SearchHighlight`](SearchHighlight.md); `node_id?`: `string` \| `null`; `raw_content?`: `string` \| `null`; `score?`: `number` \| `null`; \}

A document match for a given node

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-highlight"></a> `highlight` | [`SearchHighlight`](SearchHighlight.md) | The highlights for the document |
| <a id="property-node_id"></a> `node_id?` | `string` \| `null` | The node id for the document. This is only useful for markdown at the moment This will only be provided if the match was on content |
| <a id="property-raw_content"></a> `raw_content?` | `string` \| `null` | The raw content of the document. This is only included for markdown files and will be the raw json node of the match |
| <a id="property-score"></a> `score?` | `number` \| `null` | The score of the result |
