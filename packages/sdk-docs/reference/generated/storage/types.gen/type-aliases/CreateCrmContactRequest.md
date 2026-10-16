# Type Alias: CreateCrmContactRequest

> **CreateCrmContactRequest** = \{ `email`: `string`; `name`: `string`; \}

Request body for `POST /crm/companies/{company_id}/contacts`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email"></a> `email` | `string` | The contact's email address, e.g. "jane@acme.com". Its domain must be one of the company's domains (400 otherwise). |
| <a id="property-name"></a> `name` | `string` | Display name for the contact. |
