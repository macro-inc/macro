# Type Alias: GetUserLinkExistsData

> **GetUserLinkExistsData** = \{ `body?`: `never`; `path?`: `never`; `query`: \{ `idp_id`: `string`; `idp_name`: `string`; \}; `url`: `"/user/link_exists"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query` | \{ `idp_id`: `string`; `idp_name`: `string`; \} | - |
| `query.idp_id` | `string` | The idp id to lookup. If not provided, the idp_name must be provided. |
| `query.idp_name` | `string` | The idp name to lookup. If not provided, the idp_id must be provided. |
| <a id="property-url"></a> `url` | `"/user/link_exists"` | - |
