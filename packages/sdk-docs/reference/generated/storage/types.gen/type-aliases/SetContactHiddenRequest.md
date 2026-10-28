# Type Alias: SetContactHiddenRequest

> **SetContactHiddenRequest** = \{ `hidden`: `boolean`; \}

Request body for `PUT /contacts/{contact_id}/hidden`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-hidden"></a> `hidden` | `boolean` | New value for `crm_contacts.hidden`. `true` hides the contact from CRM listings for the team; `false` un-hides it. Display-only — does not affect populate/depopulate. |
