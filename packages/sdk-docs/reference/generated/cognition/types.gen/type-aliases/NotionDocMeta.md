# Type Alias: NotionDocMeta

> **NotionDocMeta** = \{ `summary?`: `string` \| `null`; `title`: `string`; `url?`: `string` \| `null`; \}

Metadata for one staged Notion page. Deliberately has NO content field:
page bodies are fetched at import time, for accepted pages only.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-summary"></a> `summary?` | `string` \| `null` | One-line summary of what the page contains. |
| <a id="property-title"></a> `title` | `string` | Page title. |
| <a id="property-url"></a> `url?` | `string` \| `null` | Deep link back to the page in Notion. |
