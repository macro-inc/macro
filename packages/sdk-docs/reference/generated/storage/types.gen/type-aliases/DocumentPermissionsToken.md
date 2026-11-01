# Type Alias: DocumentPermissionsToken

> **DocumentPermissionsToken** = \{ `access_level`: [`AccessLevel`](AccessLevel.md); `document_id`: `string`; `exp`: `number`; `iss`: `string`; `user_id?`: `null` \| [`MacroUserIdStr`](MacroUserIdStr.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-access_level"></a> `access_level` | [`AccessLevel`](AccessLevel.md) | The access level of the user for the document |
| <a id="property-document_id"></a> `document_id` | `string` | The document id |
| <a id="property-exp"></a> `exp` | `number` | The expiration time of the token |
| <a id="property-iss"></a> `iss` | `string` | The issuer of the token |
| <a id="property-user_id"></a> `user_id?` | `null` \| [`MacroUserIdStr`](MacroUserIdStr.md) | - |
