# Type Alias: ImportRun

> **ImportRun** = \{ `auto_import`: `boolean`; `error?`: `string` \| `null`; `source`: [`ImportSource`](ImportSource.md); `status`: [`RunStatus`](RunStatus.md); `updated_at`: `string`; \}

Gather-run state for one user × source.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-auto_import"></a> `auto_import` | `boolean` | Whether this run should import its onboarding-staged candidates as soon as gathering finishes. |
| <a id="property-error"></a> `error?` | `string` \| `null` | Gather or automatic-import failure detail, when the run failed. |
| <a id="property-source"></a> `source` | [`ImportSource`](ImportSource.md) | The source this run gathered from. |
| <a id="property-status"></a> `status` | [`RunStatus`](RunStatus.md) | Where the run is in its lifecycle. |
| <a id="property-updated_at"></a> `updated_at` | `string` | When the run state last changed. |
