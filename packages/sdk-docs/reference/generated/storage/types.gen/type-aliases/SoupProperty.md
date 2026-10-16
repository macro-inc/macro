# Type Alias: SoupProperty

> **SoupProperty** = \{ `definition`: [`PropertyDefinition`](PropertyDefinition.md); `id`: `string`; `value?`: `null` \| [`PropertyValue`](PropertyValue.md); \}

A property attached to a Soup item.

This is a simplified representation that includes only the definition and value,
omitting the entity property assignment metadata and options.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-definition"></a> `definition` | [`PropertyDefinition`](PropertyDefinition.md) | The property definition |
| <a id="property-id"></a> `id` | `string` | Globally unique id of the assignment attaching this property to an entity. |
| <a id="property-value"></a> `value?` | `null` \| [`PropertyValue`](PropertyValue.md) | - |
