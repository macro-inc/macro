# Type Alias: StructuredCompletionResponse

> **StructuredCompletionResponse** = \{ `outcome`: [`StructuredCompletionOutcome`](StructuredCompletionOutcome.md); `toolActivity`: [`StructuredToolActivity`](StructuredToolActivity.md)[]; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-outcome"></a> `outcome` | [`StructuredCompletionOutcome`](StructuredCompletionOutcome.md) | - |
| <a id="property-toolactivity"></a> `toolActivity` | [`StructuredToolActivity`](StructuredToolActivity.md)[] | Actual completed tools, independent of the model's claims. |
