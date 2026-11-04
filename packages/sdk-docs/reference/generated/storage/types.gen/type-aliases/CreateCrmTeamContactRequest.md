# Type Alias: CreateCrmTeamContactRequest

> **CreateCrmTeamContactRequest** = \{ `email?`: `string` \| `null`; `name`: `string`; \}

Request body for `POST /crm/contacts`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email"></a> `email?` | `string` \| `null` | The contact's email address, of any domain. Optional: omit it to add the contact by name only. |
| <a id="property-name"></a> `name` | `string` | Display name for the contact. |
