# Type Alias: SetCrmContactNameData

> **SetCrmContactNameData** = \{ `body`: [`SetContactNameRequest`](SetContactNameRequest.md); `path`: \{ `contact_id`: `string`; \}; `query?`: `never`; `url`: `"/crm/contacts/{contact_id}/name"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`SetContactNameRequest`](SetContactNameRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `contact_id`: `string`; \} | - |
| `path.contact_id` | `string` | The CRM contact to rename |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/crm/contacts/{contact_id}/name"` | - |
