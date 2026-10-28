# Type Alias: EntityPropertyOptionUpdateRequest

> **EntityPropertyOptionUpdateRequest** = \{ `add_option_ids?`: `string`[]; `property_id`: `string`; `remove_option_ids?`: `string`[]; \}

One property's option changes in a bulk selection update. The change is a
delta (options to add / remove) so it composes with concurrent edits rather
than replacing the whole value.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-add_option_ids"></a> `add_option_ids?` | `string`[] | Options to add (deduped against the current value). |
| <a id="property-property_id"></a> `property_id` | `string` | The multi-select property definition being changed. |
| <a id="property-remove_option_ids"></a> `remove_option_ids?` | `string`[] | Options to remove (a no-op if not present). |
