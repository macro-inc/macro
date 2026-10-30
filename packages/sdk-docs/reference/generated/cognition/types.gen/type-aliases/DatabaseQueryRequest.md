# Type Alias: DatabaseQueryRequest

> **DatabaseQueryRequest** = \{ `error?`: `string` \| `null`; `model`: `string`; `prompt`: `string`; `schema`: `unknown`; `sql`: `string`; \}

The question and untrusted schema hints; authorization remains in the read services.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-error"></a> `error?` | `string` \| `null` | The SQL engine's error from one failed proposal, used for a bounded repair. |
| <a id="property-model"></a> `model` | `string` | - |
| <a id="property-prompt"></a> `prompt` | `string` | - |
| <a id="property-schema"></a> `schema` | `unknown` | - |
| <a id="property-sql"></a> `sql` | `string` | - |
