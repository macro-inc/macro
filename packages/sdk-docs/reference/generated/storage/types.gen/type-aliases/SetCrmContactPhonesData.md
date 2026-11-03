# Type Alias: SetCrmContactPhonesData

> **SetCrmContactPhonesData** = \{ `body`: [`SetContactPhonesRequest`](SetContactPhonesRequest.md); `path`: \{ `contact_id`: `string`; \}; `query?`: `never`; `url`: `"/crm/contacts/{contact_id}/phones"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`SetContactPhonesRequest`](SetContactPhonesRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `contact_id`: `string`; \} | - |
| `path.contact_id` | `string` | The CRM contact |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/crm/contacts/{contact_id}/phones"` | - |
