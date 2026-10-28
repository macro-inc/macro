# Type Alias: SetContactHiddenData

> **SetContactHiddenData** = \{ `body`: [`SetContactHiddenRequest`](SetContactHiddenRequest.md); `path`: \{ `contact_id`: `string`; \}; `query?`: `never`; `url`: `"/crm/contacts/{contact_id}/hidden"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`SetContactHiddenRequest`](SetContactHiddenRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `contact_id`: `string`; \} | - |
| `path.contact_id` | `string` | The CRM contact to update |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/crm/contacts/{contact_id}/hidden"` | - |
