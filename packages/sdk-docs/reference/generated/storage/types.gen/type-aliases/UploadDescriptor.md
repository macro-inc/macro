# Type Alias: UploadDescriptor

> **UploadDescriptor** = \{ `byteLength`: `number`; `recordCount?`: `number` \| `null`; `sha256`: [`Sha256Digest`](Sha256Digest.md); `upload`: [`UploadId`](UploadId.md); \}

Immutable expected object properties, registered before signing an upload.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bytelength"></a> `byteLength` | `number` | Exact byte length including delimiters. |
| <a id="property-recordcount"></a> `recordCount?` | `number` \| `null` | Exact NDJSON record count; null for the users JSON payload. |
| <a id="property-sha256"></a> `sha256` | [`Sha256Digest`](Sha256Digest.md) | SHA-256 of the exact uploaded bytes, not the ETag. |
| <a id="property-upload"></a> `upload` | [`UploadId`](UploadId.md) | Manifest identity within this job. |
