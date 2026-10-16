# Type Alias: SetPropertyValue

> **SetPropertyValue** = \{ `type`: `"boolean"`; `value`: `boolean`; \} \| \{ `type`: `"date"`; `value`: `string`; \} \| \{ `type`: `"number"`; `value`: `number`; \} \| \{ `type`: `"string"`; `value`: `string`; \} \| \{ `option_id`: `string`; `type`: `"select_option"`; \} \| \{ `option_ids`: `string`[]; `type`: `"multi_select_option"`; \} \| \{ `reference`: [`EntityReference`](EntityReference.md); `type`: `"entity_reference"`; \} \| \{ `references`: [`EntityReference`](EntityReference.md)[]; `type`: `"multi_entity_reference"`; \} \| \{ `type`: `"link"`; `url`: `string`; \} \| \{ `type`: `"multi_link"`; `urls`: `string`[]; \}

Type-safe enum for setting entity property values - provides compile-time validation.
