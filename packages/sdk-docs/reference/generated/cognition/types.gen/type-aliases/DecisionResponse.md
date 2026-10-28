# Type Alias: DecisionResponse

> **DecisionResponse** = \{ `probabilities`: \{\[`key`: `string`\]: `number`; \}; \}

The probability of yes for every requested question, under its original key.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-probabilities"></a> `probabilities` | \{\[`key`: `string`\]: `number`; \} | Probabilities between zero and one, inclusive; not boolean decisions. |
