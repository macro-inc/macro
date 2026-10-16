# Type Alias: Team

> **Team** = \{ `allow_non_admin_invites`: `boolean`; `auto_join_domain?`: `string` \| `null`; `crm_enabled`: `boolean`; `default_link_share?`: `null` \| [`LinkShare`](LinkShare.md); `enterprise`: `boolean`; `id`: `string`; `name`: `string`; `owner_id`: `string`; `slug`: `string`; \}

The Team struct

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-allow_non_admin_invites"></a> `allow_non_admin_invites` | `boolean` | Whether non-admin members may invite users to the team. Defaults to true; admins can turn it off so only admins/owners may invite. |
| <a id="property-auto_join_domain"></a> `auto_join_domain?` | `string` \| `null` | The email domain new users are automatically joined to this team with, when automatic domain joining is enabled (None otherwise). |
| <a id="property-crm_enabled"></a> `crm_enabled` | `boolean` | Whether the CRM is enabled for this team (from `team_crm_settings`; `false` when no row exists). |
| <a id="property-default_link_share"></a> `default_link_share?` | `null` \| [`LinkShare`](LinkShare.md) | - |
| <a id="property-enterprise"></a> `enterprise` | `boolean` | Whether this team is on an enterprise license. Enterprise teams are billed out-of-band; membership changes skip all Stripe subscription bookkeeping (no seat counts, no subscription backfill, no paying check). |
| <a id="property-id"></a> `id` | `string` | - |
| <a id="property-name"></a> `name` | `string` | - |
| <a id="property-owner_id"></a> `owner_id` | `string` | - |
| <a id="property-slug"></a> `slug` | `string` | - |
