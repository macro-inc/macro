# Type Alias: CreateMarkdownDocumentRequest

> **CreateMarkdownDocumentRequest** = \{ `documentName`: `string`; `markdown?`: `string` \| `null`; `projectId?`: `string` \| `null`; `skipHistory?`: `boolean`; \}

Request body for creating a markdown document whose content is initialized
by the backend.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-documentname"></a> `documentName` | `string` | The document name. |
| <a id="property-markdown"></a> `markdown?` | `string` \| `null` | Markdown source text. Defaults to an empty document. |
| <a id="property-projectid"></a> `projectId?` | `string` \| `null` | Optional project ID to associate the document with. |
| <a id="property-skiphistory"></a> `skipHistory?` | `boolean` | Whether to add a viewed_at record for this document upon creation. |
