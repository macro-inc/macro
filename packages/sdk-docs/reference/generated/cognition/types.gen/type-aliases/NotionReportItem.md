# Type Alias: NotionReportItem

> **NotionReportItem** = \{ `importId`: `string`; `kind`: [`ImportKind`](ImportKind.md); `reason?`: `string` \| `null`; `title`: `string`; `url?`: `string` \| `null`; \}

One object a workspace import report calls out.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-importid"></a> `importId` | `string` | The ledger row. |
| <a id="property-kind"></a> `kind` | [`ImportKind`](ImportKind.md) | What the object is. |
| <a id="property-reason"></a> `reason?` | `string` \| `null` | Why it is called out: the decision model's reason, or the failure. |
| <a id="property-title"></a> `title` | `string` | The object's title. |
| <a id="property-url"></a> `url?` | `string` \| `null` | Its Notion URL. |
