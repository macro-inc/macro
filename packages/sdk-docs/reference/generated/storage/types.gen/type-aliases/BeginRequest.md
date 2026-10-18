# Type Alias: BeginRequest

> **BeginRequest** = \{ `provider`: [`MetaProvider`](MetaProvider.md); `reconnect_id?`: `string` \| `null`; \}

Initiate a product-specific official login.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-provider"></a> `provider` | [`MetaProvider`](MetaProvider.md) | Product to connect. |
| <a id="property-reconnect_id"></a> `reconnect_id?` | `string` \| `null` | Existing connection identity, when reconnecting. |
