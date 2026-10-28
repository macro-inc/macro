# Type Alias: FormQuestionDetail

> **FormQuestionDetail** = \{ `column`: `string`; `helpText`: `string`; `id`: `string`; `kind`: [`ColumnKind`](ColumnKind.md); `options`: [`QuestionOption`](QuestionOption.md)[]; `required`: `boolean`; `title`: `string`; `widget`: `null` \| [`Widget`](Widget.md); \}

A question with its column's facts.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-column"></a> `column` | `string` | The column it writes. |
| <a id="property-helptext"></a> `helpText` | `string` | What respondents read under the title. |
| <a id="property-id"></a> `id` | `string` | The question. |
| <a id="property-kind"></a> `kind` | [`ColumnKind`](ColumnKind.md) | The column's type. |
| <a id="property-options"></a> `options` | [`QuestionOption`](QuestionOption.md)[] | The column's options, in order, for a select or tag column. |
| <a id="property-required"></a> `required` | `boolean` | Whether a response must answer it. |
| <a id="property-title"></a> `title` | `string` | The column's name. |
| <a id="property-widget"></a> `widget` | `null` \| [`Widget`](Widget.md) | - |
