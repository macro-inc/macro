# Type Alias: CreateCrmContactData

> **CreateCrmContactData** = \{ `body`: [`CreateCrmContactRequest`](CreateCrmContactRequest.md); `path`: \{ `company_id`: `string`; \}; `query?`: `never`; `url`: `"/crm/companies/{company_id}/contacts"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`CreateCrmContactRequest`](CreateCrmContactRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `company_id`: `string`; \} | - |
| `path.company_id` | `string` | The CRM company to add the contact to |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/crm/companies/{company_id}/contacts"` | - |
