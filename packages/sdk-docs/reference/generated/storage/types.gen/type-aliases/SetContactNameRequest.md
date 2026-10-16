# Type Alias: SetContactNameRequest

> **SetContactNameRequest** = \{ `name`: `string`; \}

Request body for `PUT /contacts/{contact_id}/name`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `string` | New display name for the contact. Stored on `crm_contacts.name`, which is already team-scoped — unlike company renames no global directory is involved. Must be non-blank (400 otherwise). |
