# Type Alias: ParsedMessage

> **ParsedMessage** = \{ `bcc`: [`ContactInfo`](ContactInfo.md)[]; `body_parsed?`: `string` \| `null`; `cc`: [`ContactInfo`](ContactInfo.md)[]; `db_id`: `string`; `draft_generation?`: `number`; `from?`: `null` \| [`ContactInfo`](ContactInfo.md); `internal_date_ts?`: `string` \| `null`; `labels`: [`LabelInfo`](LabelInfo.md)[]; `link_id`: `string`; `subject?`: `string` \| `null`; `thread_db_id`: `string`; `to`: [`ContactInfo`](ContactInfo.md)[]; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bcc"></a> `bcc` | [`ContactInfo`](ContactInfo.md)[] | - |
| <a id="property-body_parsed"></a> `body_parsed?` | `string` \| `null` | - |
| <a id="property-cc"></a> `cc` | [`ContactInfo`](ContactInfo.md)[] | - |
| <a id="property-db_id"></a> `db_id` | `string` | - |
| <a id="property-draft_generation"></a> `draft_generation?` | `number` | Draft edit generation captured with this message snapshot. |
| <a id="property-from"></a> `from?` | `null` \| [`ContactInfo`](ContactInfo.md) | - |
| <a id="property-internal_date_ts"></a> `internal_date_ts?` | `string` \| `null` | - |
| <a id="property-labels"></a> `labels` | [`LabelInfo`](LabelInfo.md)[] | - |
| <a id="property-link_id"></a> `link_id` | `string` | - |
| <a id="property-subject"></a> `subject?` | `string` \| `null` | - |
| <a id="property-thread_db_id"></a> `thread_db_id` | `string` | - |
| <a id="property-to"></a> `to` | [`ContactInfo`](ContactInfo.md)[] | - |
