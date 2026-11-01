# Type Alias: RegisterUploads

> **RegisterUploads** = \{ `descriptors`: [`UploadDescriptor`](UploadDescriptor.md)[]; \}

Batched registration, also used to renew an unchanged descriptor's grant.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-descriptors"></a> `descriptors` | [`UploadDescriptor`](UploadDescriptor.md)[] | At most 50 descriptors; no duplicate identities in a call. |
