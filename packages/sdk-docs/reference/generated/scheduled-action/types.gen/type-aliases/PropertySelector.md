# Type Alias: PropertySelector

> **PropertySelector** = \{ `definitionId`: `string`; `values?`: `string`[]; \}

Narrows a task property change filter to one property and, optionally, the
values it must gain.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-definitionid"></a> `definitionId` | `string` | The property definition that must have changed. |
| <a id="property-values"></a> `values?` | `string`[] | Select option ids or referenced entity ids, one of which the change must add. Any change to the property matches when empty. |
