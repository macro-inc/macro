# Type Alias: StructuredCompletionRequest

> **StructuredCompletionRequest** = \{ `additional_instructions?`: `string` \| `null`; `model`: `string`; `output_schema`: [`DynamicSchema`](DynamicSchema.md); `prompt`: `string`; `thinking?`: [`CompletionThinking`](CompletionThinking.md); `toolset?`: [`ToolSet`](ToolSet.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-additional_instructions"></a> `additional_instructions?` | `string` \| `null` | - |
| <a id="property-model"></a> `model` | `string` | - |
| <a id="property-output_schema"></a> `output_schema` | [`DynamicSchema`](DynamicSchema.md) | - |
| <a id="property-prompt"></a> `prompt` | `string` | - |
| <a id="property-thinking"></a> `thinking?` | [`CompletionThinking`](CompletionThinking.md) | How much the model may think first; `low` answers faster. Applies to completions without tools. |
| <a id="property-toolset"></a> `toolset?` | [`ToolSet`](ToolSet.md) | - |
