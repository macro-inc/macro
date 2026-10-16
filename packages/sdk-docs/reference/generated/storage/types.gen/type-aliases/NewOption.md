# Type Alias: NewOption

> **NewOption** = \{ `id`: `string`; `label`: `string`; \}

A select or tag option to create.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `string` | Its id, minted by the client; later ops of the request may name it. |
| <a id="property-label"></a> `label` | `string` | Its label, unique within the column ignoring case. A numeric select's labels are numbers. |
