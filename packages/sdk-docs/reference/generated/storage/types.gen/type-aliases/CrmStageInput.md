# Type Alias: CrmStageInput

> **CrmStageInput** = \{ `id?`: `string` \| `null`; `label`: `string`; \}

One stage in a `PUT /crm/stages` body.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id?` | `string` \| `null` | Existing stage to keep; omit to add one. |
| <a id="property-label"></a> `label` | `string` | Label after the update; non-blank and unique within the set. |
