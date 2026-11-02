# Type Alias: CreateCrmContactRequest

> **CreateCrmContactRequest** = \{ `email`: `string`; `name`: `string`; \}

Request body for `POST /crm/companies/{company_id}/contacts`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email"></a> `email` | `string` | The contact's email address, including personal email providers. It need not match a company domain. |
| <a id="property-name"></a> `name` | `string` | Display name for the contact. |
