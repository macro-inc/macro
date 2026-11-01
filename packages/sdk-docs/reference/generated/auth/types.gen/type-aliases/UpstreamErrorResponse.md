# Type Alias: UpstreamErrorResponse

> **UpstreamErrorResponse** = \{ `code`: [`UpstreamErrorCode`](UpstreamErrorCode.md); `message`: `string`; \}

The body of a 502 or 503 caused by a third-party service.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | [`UpstreamErrorCode`](UpstreamErrorCode.md) | The kind of failure. |
| <a id="property-message"></a> `message` | `string` | What failed and what to do about it, written for the user. |
