# Type Alias: ImportTable

> **ImportTable** = \{ `columns`: `string`[]; `name`: `string`; `requestId`: `string`; `rows`: `string`[][]; \}

An import is identified once, before sending, so retries cannot duplicate rows.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-columns"></a> `columns` | `string`[] | Header names, in order. All imported values remain text. |
| <a id="property-name"></a> `name` | `string` | New table's display name. |
| <a id="property-requestid"></a> `requestId` | `string` | Stable key for this import, retained through retries. |
| <a id="property-rows"></a> `rows` | `string`[][] | Rectangular text rows. Empty fields are preserved. |
