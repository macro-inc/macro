# Type Alias: ResponseSummary

> **ResponseSummary** = \{ `rows`: `number`; `stopped`: `number`; `stoppedBySection`: [`SectionCount`](SectionCount.md)[]; `submitted`: `number`; \}

A form's response counts, for its editors.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-rows"></a> `rows` | `number` | Rows of the form's table, whoever wrote them. |
| <a id="property-stopped"></a> `stopped` | `number` | Respondents stopped at a gate. |
| <a id="property-stoppedbysection"></a> `stoppedBySection` | [`SectionCount`](SectionCount.md)[] | The stops, by gate. |
| <a id="property-submitted"></a> `submitted` | `number` | Responses saved. |
