# Type Alias: Settings

> **Settings** = \{ `signature?`: `string` \| `null`; `signature_on_replies_forwards?`: `boolean` \| `null`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-signature"></a> `signature?` | `string` \| `null` | The user's email signature content (HTML). On a patch, omit or send `null` to leave unchanged (both deserialize to `None`); pass an empty string to clear it. The column cannot be set to SQL NULL via patch. |
| <a id="property-signature_on_replies_forwards"></a> `signature_on_replies_forwards?` | `boolean` \| `null` | - |
