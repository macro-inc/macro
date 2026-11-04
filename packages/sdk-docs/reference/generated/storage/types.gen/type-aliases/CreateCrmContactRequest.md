# Type Alias: CreateCrmContactRequest

> **CreateCrmContactRequest** = \{ `email?`: `string` \| `null`; `name`: `string`; \}

Request body for `POST /crm/companies/{company_id}/contacts`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email"></a> `email?` | `string` \| `null` | The contact's email address, including personal email providers. It need not match a company domain. Optional: omit it to add the contact by name only. |
| <a id="property-name"></a> `name` | `string` | Display name for the contact. |
