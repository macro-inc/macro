# Type Alias: TallyBucket

> **TallyBucket** = \{ `count`: `number`; `value`: [`TallyValue`](TallyValue.md); `voters?`: `string`[] \| `null`; \}

How many rows hold one value.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-count"></a> `count` | `number` | How many rows hold it. |
| <a id="property-value"></a> `value` | [`TallyValue`](TallyValue.md) | The value. |
| <a id="property-voters"></a> `voters?` | `string`[] \| `null` | Who chose it, as Macro user ids in submission order: present only for the form's editors, or its viewers when it shares its responses, and never when it hides respondents. Rows no signed-in respondent submitted count without a voter. |
