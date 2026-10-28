# Type Alias: SoupCrmDomain

> **SoupCrmDomain** = \{ `companyId`: `string`; `createdAt`: `string`; `domain`: `string`; `id`: `string`; \}

A CRM domain as displayed in Soup. Mirrors the crm crate's
[`CrmDomain`] with a stable wire shape that the FE can rely on.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-companyid"></a> `companyId` | `string` | The id of the company the domain belongs to. |
| <a id="property-createdat"></a> `createdAt` | `string` | When the domain record was created. |
| <a id="property-domain"></a> `domain` | `string` | The domain (lowercased, e.g. "acme.com"). |
| <a id="property-id"></a> `id` | `string` | The id of the domain record. |
