# Type Alias: UploadGrant

> **UploadGrant** = \{ `descriptor`: [`UploadDescriptor`](UploadDescriptor.md); `expiresAt`: `string`; `requiredHeaders`: \{\[`key`: `string`\]: `string`; \}; `url`: `string`; \}

Signed upload permission returned just before PUT; never persisted as an identity.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-descriptor"></a> `descriptor` | [`UploadDescriptor`](UploadDescriptor.md) | Exact immutable descriptor being signed. |
| <a id="property-expiresat"></a> `expiresAt` | `string` | Grant expiry; callers renew by re-registering the identical descriptor. |
| <a id="property-requiredheaders"></a> `requiredHeaders` | \{\[`key`: `string`\]: `string`; \} | Required signed upload headers (including checksum, content type and create-only condition). Browser-forbidden Content-Length is derived from the exact Blob bytes. |
| <a id="property-url"></a> `url` | `string` | Short-lived signed destination; must not be logged. |
