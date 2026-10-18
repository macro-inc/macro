# Type Alias: MetaHistoryImport

> **MetaHistoryImport** = \{ `error_code?`: `string` \| `null`; `progress?`: `number` \| `null`; `requested_at`: `string`; `status`: [`MetaHistoryStatus`](MetaHistoryStatus.md); `unavailable_media`: `boolean`; \}

Durable import status safe to display in account settings.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-error_code"></a> `error_code?` | `string` \| `null` | Sanitized, actionable recovery reason. |
| <a id="property-progress"></a> `progress?` | `number` \| `null` | Provider progress, when available. |
| <a id="property-requested_at"></a> `requested_at` | `string` | Explicit consent time, independent of connection time. |
| <a id="property-status"></a> `status` | [`MetaHistoryStatus`](MetaHistoryStatus.md) | Current import outcome; acceptance is not completion. |
| <a id="property-unavailable_media"></a> `unavailable_media` | `boolean` | Some media was unavailable, with a notice retained in its channel. |
