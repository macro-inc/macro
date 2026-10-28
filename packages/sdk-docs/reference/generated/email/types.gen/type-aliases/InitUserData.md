# Type Alias: InitUserData

> **InitUserData** = \{ `body?`: `never`; `path?`: `never`; `query?`: \{ `force_share?`: `boolean`; `link_id?`: `string`; \}; `url`: `"/email/init"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path?` | `never` | - |
| <a id="property-query"></a> `query?` | \{ `force_share?`: `boolean`; `link_id?`: `string`; \} | - |
| `query.force_share?` | `boolean` | **OPTIONAL**. Confirms promoting a mailbox already connected by another user into a shared inbox. |
| `query.link_id?` | `string` | **OPTIONAL**. The in_progress_user_link id from a /link/gmail flow. |
| <a id="property-url"></a> `url` | `"/email/init"` | - |
