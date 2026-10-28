# Type Alias: EntityPropertyOptionSelectionResponse

> **EntityPropertyOptionSelectionResponse** = \{ `option_ids`: `string`[]; `property_id`: `string`; \}

The reconciled final option ids stored for one property after a bulk update.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-option_ids"></a> `option_ids` | `string`[] | The final option ids the server persisted, in stored order. |
| <a id="property-property_id"></a> `property_id` | `string` | The property definition the options belong to. |
