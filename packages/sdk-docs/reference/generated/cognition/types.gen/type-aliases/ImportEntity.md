# Type Alias: ImportEntity

> **ImportEntity** = \{ `created_at`: `string`; `entity_id?`: `string` \| `null`; `entity_type?`: `string` \| `null`; `foreign_id`: `string`; `id`: `string`; `initiator`: [`Initiator`](Initiator.md); `last_error?`: `string` \| `null`; `metadata`: `unknown`; `source`: [`ImportSource`](ImportSource.md); `status`: [`ImportStatus`](ImportStatus.md); `team_id?`: `string` \| `null`; `updated_at`: `string`; `user_id`: `string`; \}

One row of the import ledger.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-created_at"></a> `created_at` | `string` | When the row was first staged. |
| <a id="property-entity_id"></a> `entity_id?` | `string` \| `null` | The Macro entity it became, once imported. |
| <a id="property-entity_type"></a> `entity_type?` | `string` \| `null` | The Macro entity type (`task` \| `md` \| `channel`), once imported. |
| <a id="property-foreign_id"></a> `foreign_id` | `string` | Stable id in the source system (see [`ImportSource::normalize_foreign_id`]). |
| <a id="property-id"></a> `id` | `string` | Ledger row id. |
| <a id="property-initiator"></a> `initiator` | [`Initiator`](Initiator.md) | Where it was first staged from. |
| <a id="property-last_error"></a> `last_error?` | `string` \| `null` | Failure detail from the last import attempt, when one failed. |
| <a id="property-metadata"></a> `metadata` | `unknown` | Per-source metadata (shape depends on `source`; see [`LinearIssueMeta`], [`NotionDocMeta`], [`SlackChannelMeta`]). |
| <a id="property-source"></a> `source` | [`ImportSource`](ImportSource.md) | The external system the item comes from. |
| <a id="property-status"></a> `status` | [`ImportStatus`](ImportStatus.md) | Where the row is in its lifecycle. |
| <a id="property-team_id"></a> `team_id?` | `string` \| `null` | The team the created entity was shared with, when it was. |
| <a id="property-updated_at"></a> `updated_at` | `string` | When the row last changed. |
| <a id="property-user_id"></a> `user_id` | `string` | The user who staged/imported it. Team-imported rows from teammates are visible with their owner's id, so clients can say "created by a teammate". |
