# Type Alias: UsageRequest

> **UsageRequest** = \{ `features?`: [`AiFeature`](AiFeature.md)[]; `from?`: `string` \| `null`; `include_users?`: `string`[]; `until?`: `string` \| `null`; \}

Request body for [`get_usage_handler`].

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-features"></a> `features?` | [`AiFeature`](AiFeature.md)[] | If empty, include all features. |
| <a id="property-from"></a> `from?` | `string` \| `null` | Inclusive lower bound on `created_at`. |
| <a id="property-include_users"></a> `include_users?` | `string`[] | If empty, include all users. |
| <a id="property-until"></a> `until?` | `string` \| `null` | Exclusive upper bound on `created_at`. |
