# Type Alias: AutoArchivedBody

> **AutoArchivedBody** = \{ `archivedAt`: `string`; `reason`: [`AutoArchiveReason`](AutoArchiveReason.md); `restoredAt?`: `string` \| `null`; \}

The time a session archived itself.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-archivedat"></a> `archivedAt` | `string` | When it archived. |
| <a id="property-reason"></a> `reason` | [`AutoArchiveReason`](AutoArchiveReason.md) | What finished the session's work. |
| <a id="property-restoredat"></a> `restoredAt?` | `string` \| `null` | When a person restored it, after which the archive no longer stands. |
