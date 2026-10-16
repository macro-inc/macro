# Type Alias: InitialPropertyValue

> **InitialPropertyValue** = \{ `propertyDefinitionId`: `string`; `value`: [`SetPropertyValue`](SetPropertyValue.md); \}

A property value set on a new initiative as part of its create.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-propertydefinitionid"></a> `propertyDefinitionId` | `string` | Property definition to set. |
| <a id="property-value"></a> `value` | [`SetPropertyValue`](SetPropertyValue.md) | Value, validated by the properties service like any other property write. |
