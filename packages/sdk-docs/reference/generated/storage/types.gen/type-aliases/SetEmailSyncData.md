# Type Alias: SetEmailSyncData

> **SetEmailSyncData** = \{ `body`: [`SetEmailSyncRequest`](SetEmailSyncRequest.md); `path`: \{ `company_id`: `string`; \}; `query?`: `never`; `url`: `"/crm/companies/{company_id}/email-sync"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body` | [`SetEmailSyncRequest`](SetEmailSyncRequest.md) | - |
| <a id="property-path"></a> `path` | \{ `company_id`: `string`; \} | - |
| `path.company_id` | `string` | The CRM company to update |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/crm/companies/{company_id}/email-sync"` | - |
