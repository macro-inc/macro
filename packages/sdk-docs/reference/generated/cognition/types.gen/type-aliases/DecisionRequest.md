# Type Alias: DecisionRequest

> **DecisionRequest** = \{ `input`: `unknown`; `questions`: \{\[`key`: `string`\]: `string`; \}; \}

Named yes/no questions to evaluate against one arbitrary JSON input.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-input"></a> `input` | `unknown` | Data to classify. The entire compact request must fit in 64 KiB. |
| <a id="property-questions"></a> `questions` | \{\[`key`: `string`\]: `string`; \} | One to 32 questions, each at most 500 characters. Keys must be nonblank and at most 80 UTF-8 bytes; they are preserved in the response. |
