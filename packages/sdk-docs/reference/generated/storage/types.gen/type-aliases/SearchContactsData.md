# Type Alias: SearchContactsData

> **SearchContactsData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `limit?`: `number` \| `null`; `query?`: `string`; \}; `url`: `"/crm/contacts"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `limit?`: `number` \| `null`; `query?`: `string`; \} | - |
| `query.limit?` | `number` \| `null` | Maximum contacts to return (1-500, default 20). |
| `query.query?` | `string` | Text the contact's email or name must contain (case-insensitive). Empty lists the most recently interacted contacts. |
| <a id="property-url"></a> `url` | `"/crm/contacts"` | - |
