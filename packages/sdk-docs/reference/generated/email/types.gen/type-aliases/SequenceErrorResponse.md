# Type Alias: SequenceErrorResponse

> **SequenceErrorResponse** = \{ `code`: [`SequenceErrorCode`](SequenceErrorCode.md); `message`: `string`; `position?`: `number` \| `null`; `problem?`: `null` \| [`Problem`](Problem.md); `tokens`: `string`[]; \}

An error response.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-code"></a> `code` | [`SequenceErrorCode`](SequenceErrorCode.md) | Machine-readable code. |
| <a id="property-message"></a> `message` | `string` | Developer-facing message. |
| <a id="property-position"></a> `position?` | `number` \| `null` | For `invalid_sequence`: the 1-based step. |
| <a id="property-problem"></a> `problem?` | `null` \| [`Problem`](Problem.md) | - |
| <a id="property-tokens"></a> `tokens` | `string`[] | For `unknown_token`: the tokens. |
