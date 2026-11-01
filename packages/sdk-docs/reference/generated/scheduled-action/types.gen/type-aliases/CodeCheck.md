# Type Alias: CodeCheck

> **CodeCheck** = \{ `sdk`: `string`; `steps`: [`CodeStepCheck`](CodeStepCheck.md)[]; \}

What type-checking a routine's code steps found.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-sdk"></a> `sdk` | `string` | The version the code was checked against. |
| <a id="property-steps"></a> `steps` | [`CodeStepCheck`](CodeStepCheck.md)[] | Each code step with problems; empty when every step checks. |
