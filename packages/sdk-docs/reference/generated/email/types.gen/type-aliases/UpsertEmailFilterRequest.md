# Type Alias: UpsertEmailFilterRequest

> **UpsertEmailFilterRequest** = \{ `email_address?`: `string` \| `null`; `email_domain?`: `string` \| `null`; `is_important`: `boolean`; \}

Request body for creating or updating an email filter.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email_address"></a> `email_address?` | `string` \| `null` | Exact email address to match. Mutually exclusive with `email_domain`. |
| <a id="property-email_domain"></a> `email_domain?` | `string` \| `null` | Email domain to match. Mutually exclusive with `email_address`. |
| <a id="property-is_important"></a> `is_important` | `boolean` | Whether matching senders should be considered important. |
