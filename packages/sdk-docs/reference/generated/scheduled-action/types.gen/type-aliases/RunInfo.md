# Type Alias: RunInfo

> **RunInfo** = \{ `at`: `string`; `previous_at?`: `string` \| `null`; `started_by`: [`RunStart`](RunStart.md); `timezone?`: `string` \| `null`; \}

What the run page says about a run: what started it, when it counts as
happening, and since when.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-at"></a> `at` | `string` | When the run counts as happening: its trigger's time. |
| <a id="property-previous_at"></a> `previous_at?` | `string` \| `null` | When the routine's previous finished run started. |
| <a id="property-started_by"></a> `started_by` | [`RunStart`](RunStart.md) | What started it. |
| <a id="property-timezone"></a> `timezone?` | `string` \| `null` | The IANA time zone code reads `at` in, when the run had one. |
