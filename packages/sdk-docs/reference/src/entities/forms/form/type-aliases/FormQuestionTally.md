# Type Alias: FormQuestionTally

> **FormQuestionTally** = \{ `buckets`: \{ `count`: `number`; `value`: \{ `kind`: `"option"`; `option`: [`FormOption`](../../question/classes/FormOption.md); \} \| \{ `checked`: `boolean`; `kind`: `"checkbox"`; \}; \}[]; `question`: [`FormQuestion`](../../question/classes/FormQuestion.md); `responses`: `number`; \}

A question's public tally. Options with no votes are retained.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-buckets"></a> `buckets` | \{ `count`: `number`; `value`: \{ `kind`: `"option"`; `option`: [`FormOption`](../../question/classes/FormOption.md); \} \| \{ `checked`: `boolean`; `kind`: `"checkbox"`; \}; \}[] |
| <a id="property-question"></a> `question` | [`FormQuestion`](../../question/classes/FormQuestion.md) |
| <a id="property-responses"></a> `responses` | `number` |
