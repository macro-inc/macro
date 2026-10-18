# Type Alias: MetaGroupParticipant

> **MetaGroupParticipant** = \{ `customer_id`: [`MetaProviderId`](MetaProviderId.md); `display_name?`: `string` \| `null`; `external_sender_id`: `string`; `phone?`: `string` \| `null`; `username?`: `string` \| `null`; \}

Confirmed external participant, independent of native teammate membership.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-customer_id"></a> `customer_id` | [`MetaProviderId`](MetaProviderId.md) | Current scoped BSUID or legacy phone. |
| <a id="property-display_name"></a> `display_name?` | `string` \| `null` | Optional provider display name. |
| <a id="property-external_sender_id"></a> `external_sender_id` | `string` | Stable native external author across departure and identity updates. |
| <a id="property-phone"></a> `phone?` | `string` \| `null` | Separately supplied phone. |
| <a id="property-username"></a> `username?` | `string` \| `null` | Optional mutable username. |
