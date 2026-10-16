# Type Alias: MergeTagRequest

> **MergeTagRequest** = \{ `option_id`: `string`; `target_option_id`: `string`; \}

Request to replace a personal label with an existing team label.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-option_id"></a> `option_id` | `string` | The personal label to retire. |
| <a id="property-target_option_id"></a> `target_option_id` | `string` | The team label every entity carrying `option_id` is retagged with. |
