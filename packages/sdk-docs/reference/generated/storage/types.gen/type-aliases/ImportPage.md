# Type Alias: ImportPage

> **ImportPage** = \{ `jobs`: [`ImportProgress`](ImportProgress.md)[]; `limits`: [`ImportLimits`](ImportLimits.md); `nextCursor?`: `null` \| [`JobId`](JobId.md); `sourceBinding`: [`SourceBinding`](SourceBinding.md); \}

Admin list result, also supplying upload limits before a job exists.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-jobs"></a> `jobs` | [`ImportProgress`](ImportProgress.md)[] | At most 50 job receipts, newest first. |
| <a id="property-limits"></a> `limits` | [`ImportLimits`](ImportLimits.md) | Effective server limits. |
| <a id="property-nextcursor"></a> `nextCursor?` | `null` \| [`JobId`](JobId.md) | - |
| <a id="property-sourcebinding"></a> `sourceBinding` | [`SourceBinding`](SourceBinding.md) | Binding summary used by the picker confirmation. |
