# Type Alias: CrmContactResponse

> **CrmContactResponse** = \{ `companyId?`: `string` \| `null`; `createdAt`: `string`; `email?`: `string` \| `null`; `firstInteraction`: `string`; `hidden`: `boolean`; `id`: `string`; `lastInteraction`: `string`; `name?`: `string` \| `null`; `updatedAt`: `string`; \}

A CRM contact as returned by `GET /crm/companies/{company_id}/contacts`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-companyid"></a> `companyId?` | `string` \| `null` | The id of the company the contact belongs to; absent for a contact without a company. |
| <a id="property-createdat"></a> `createdAt` | `string` | When the contact record was created. |
| <a id="property-email"></a> `email?` | `string` \| `null` | The contact's email address; absent for contacts added by name alone. |
| <a id="property-firstinteraction"></a> `firstInteraction` | `string` | Earliest known interaction with this contact. |
| <a id="property-hidden"></a> `hidden` | `boolean` | Whether the contact is hidden from CRM listings for the requesting team. Non-admin viewers never see `hidden = true` rows (the endpoint filters them out); admin/owner callers see hidden contacts so they can render the right toggle state. |
| <a id="property-id"></a> `id` | `string` | The id of the contact record. |
| <a id="property-lastinteraction"></a> `lastInteraction` | `string` | Most recent known interaction with this contact. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Display name observed for the contact, if any. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | When the contact record was last updated. |
