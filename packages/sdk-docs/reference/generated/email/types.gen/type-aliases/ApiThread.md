# Type Alias: ApiThread

> **ApiThread** = \{ `access_level`: [`AccessLevel`](AccessLevel.md); `created_at`: `string`; `db_id`: `string`; `inbox_visible`: `boolean`; `is_read`: `boolean`; `latest_inbound_message_ts?`: `string` \| `null`; `latest_non_spam_message_ts?`: `string` \| `null`; `latest_outbound_message_ts?`: `string` \| `null`; `link_id`: `string`; `messages`: [`ApiMessage`](ApiMessage.md)[]; `project_id?`: `string` \| `null`; `provider_id?`: `string` \| `null`; `updated_at`: `string`; \}

API representation of a fully assembled email thread.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-access_level"></a> `access_level` | [`AccessLevel`](AccessLevel.md) |
| <a id="property-created_at"></a> `created_at` | `string` |
| <a id="property-db_id"></a> `db_id` | `string` |
| <a id="property-inbox_visible"></a> `inbox_visible` | `boolean` |
| <a id="property-is_read"></a> `is_read` | `boolean` |
| <a id="property-latest_inbound_message_ts"></a> `latest_inbound_message_ts?` | `string` \| `null` |
| <a id="property-latest_non_spam_message_ts"></a> `latest_non_spam_message_ts?` | `string` \| `null` |
| <a id="property-latest_outbound_message_ts"></a> `latest_outbound_message_ts?` | `string` \| `null` |
| <a id="property-link_id"></a> `link_id` | `string` |
| <a id="property-messages"></a> `messages` | [`ApiMessage`](ApiMessage.md)[] |
| <a id="property-project_id"></a> `project_id?` | `string` \| `null` |
| <a id="property-provider_id"></a> `provider_id?` | `string` \| `null` |
| <a id="property-updated_at"></a> `updated_at` | `string` |
