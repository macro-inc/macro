# Type Alias: SetCompanyHiddenRequest

> **SetCompanyHiddenRequest** = \{ `hidden`: `boolean`; \}

Request body for `PUT /companies/{company_id}/hidden`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-hidden"></a> `hidden` | `boolean` | New value for `crm_companies.hidden`. Setting to `true` hides the company from CRM listings, disables `email_sync`, and soft-hides every contact under it (`crm_contacts.hidden = true`). Contact rows and `crm_contact_sources` are preserved across the cycle, so un-hide is a true reverse. Setting to `false` un-hides the company and soft-restores its contacts; `email_sync` is left untouched and the team must re-enable it explicitly. |
