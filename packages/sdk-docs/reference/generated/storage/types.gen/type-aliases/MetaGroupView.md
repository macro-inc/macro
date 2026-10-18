# Type Alias: MetaGroupView

> **MetaGroupView** = \{ `can_copy_link`: `boolean`; `can_delete`: `boolean`; `can_remove`: `boolean`; `can_retry`: `boolean`; `channel_id`: `string`; `participants`: [`MetaGroupParticipant`](MetaGroupParticipant.md)[]; `setup?`: `null` \| [`MetaGroupSetup`](MetaGroupSetup.md); `status?`: `null` \| [`MetaGroupStatus`](MetaGroupStatus.md); \}

Restricted group controls and participants; invite link is fetched separately.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-can_copy_link"></a> `can_copy_link` | `boolean` | Native posting permission and business team membership. |
| <a id="property-can_delete"></a> `can_delete` | `boolean` | Native ownership and business team membership. |
| <a id="property-can_remove"></a> `can_remove` | `boolean` | Native participant admin permission and team membership. |
| <a id="property-can_retry"></a> `can_retry` | `boolean` | Current connector and owner may deliberately retry creation. |
| <a id="property-channel_id"></a> `channel_id` | `string` | Native identity. |
| <a id="property-participants"></a> `participants` | [`MetaGroupParticipant`](MetaGroupParticipant.md)[] | Confirmed current participants. |
| <a id="property-setup"></a> `setup?` | `null` \| [`MetaGroupSetup`](MetaGroupSetup.md) | - |
| <a id="property-status"></a> `status?` | `null` \| [`MetaGroupStatus`](MetaGroupStatus.md) | - |
