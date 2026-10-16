# Type Alias: PasswordlessCallbackData

> **PasswordlessCallbackData** = \{ `body?`: `never`; `path`: \{ `code`: `string`; \}; `query`: \{ `email`: `string`; \}; `url`: `"/oauth/passwordless/{code}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `code`: `string`; \} | - |
| `path.code` | `string` | Code |
| <a id="property-query"></a> `query` | \{ `email`: `string`; \} | - |
| `query.email` | `string` | Email |
| <a id="property-url"></a> `url` | `"/oauth/passwordless/{code}"` | - |
