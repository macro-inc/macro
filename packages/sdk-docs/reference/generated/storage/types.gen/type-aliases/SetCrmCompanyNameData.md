# Type Alias: SetCrmCompanyNameData

> **SetCrmCompanyNameData** = \{ `body`: [`SetCompanyNameRequest`](SetCompanyNameRequest.md); `path`: \{ `company_id`: `string`; \}; `query?`: `never`; `url`: `"/crm/companies/{company_id}/name"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`SetCompanyNameRequest`](SetCompanyNameRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `company_id`: `string`; \} | - |
| `path.company_id` | `string` | The CRM company to rename |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/crm/companies/{company_id}/name"` | - |
