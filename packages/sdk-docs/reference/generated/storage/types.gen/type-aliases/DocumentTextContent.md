# Type Alias: DocumentTextContent

> **DocumentTextContent** = \{ `text`: `string` \| `null`; \}

Text representation when the document supports one. Other file formats
retain their existing download/export behavior.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-text"></a> `text` | `string` \| `null` | Current Markdown, or extracted PDF/Word text. Null means use file export. |
