# Type Alias: ChangesetDto

> **ChangesetDto** = \{ `additions`: `number`; `base`: [`GitRefDto`](GitRefDto.md); `capturedAt`: `string`; `deletions`: `number`; `files`: [`ChangedFileDto`](ChangedFileDto.md)[]; `head`: [`GitRefDto`](GitRefDto.md); `id`: `string`; `patchBytes`: `number`; `repository?`: `string` \| `null`; `source`: [`ChangesetSourceDto`](ChangesetSourceDto.md); `truncated`: `boolean`; \}

One changeset: the files a patch touches and what happened to each.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-additions"></a> `additions` | `number` | Lines added across all files. |
| <a id="property-base"></a> `base` | [`GitRefDto`](GitRefDto.md) | The side the work started from. |
| <a id="property-capturedat"></a> `capturedAt` | `string` | When the diff was taken. |
| <a id="property-deletions"></a> `deletions` | `number` | Lines removed across all files. |
| <a id="property-files"></a> `files` | [`ChangedFileDto`](ChangedFileDto.md)[] | Every changed file, in patch order. |
| <a id="property-head"></a> `head` | [`GitRefDto`](GitRefDto.md) | The side carrying the work. |
| <a id="property-id"></a> `id` | `string` | The changeset's id; a different id means different changes. |
| <a id="property-patchbytes"></a> `patchBytes` | `number` | Size of the patch the matching patch route serves; zero when nothing changed. |
| <a id="property-repository"></a> `repository?` | `string` \| `null` | `https://github.com/owner/name`, when known. |
| <a id="property-source"></a> `source` | [`ChangesetSourceDto`](ChangesetSourceDto.md) | Where the diff was read from. |
| <a id="property-truncated"></a> `truncated` | `boolean` | Some files' hunks were left out of the patch. |
