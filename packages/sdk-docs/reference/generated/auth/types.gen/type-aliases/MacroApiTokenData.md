# Type Alias: MacroApiTokenData

> **MacroApiTokenData** = \{ `body?`: `never`; `path?`: `never`; `query`: \{ `email`: `string`; \}; `url`: `"/jwt/macro_api_token"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query` | \{ `email`: `string`; \} | - |
| `query.email` | `string` | The email to generate the macro-api-token for. If not provided, we use your default profile. |
| <a id="property-url"></a> `url` | `"/jwt/macro_api_token"` | - |
