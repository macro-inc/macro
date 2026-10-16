# Class: AiNamespace

Shared cognition endpoints, charged to the authenticated acting user.

## Constructors

### Constructor

> **new AiNamespace**(`client`): `AiNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`AiNamespace`

## Methods

### decide()

> **decide**(`request`): `Promise`\<[`DecisionResponse`](../../../../../generated/cognition/types.gen/type-aliases/DecisionResponse.md)\>

Ask named yes/no questions about JSON input. Each probability estimates
yes, from 0 to 1. This classifies supplied data without running tools.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`DecisionRequest`](../../../../../generated/cognition/types.gen/type-aliases/DecisionRequest.md) |

#### Returns

`Promise`\<[`DecisionResponse`](../../../../../generated/cognition/types.gen/type-aliases/DecisionResponse.md)\>

***

### structuredCompletion()

> **structuredCompletion**(`request`): `Promise`\<[`StructuredCompletionResponse`](../../../../../generated/cognition/types.gen/type-aliases/StructuredCompletionResponse.md)\>

Generate an answer matching a JSON Schema. Set toolset to { type: 'none' }
to use only supplied context. Other toolsets can perform the requested
actions; always inspect outcome and toolActivity, including interruptions.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `request` | [`StructuredCompletionRequest`](../../../../../generated/cognition/types.gen/type-aliases/StructuredCompletionRequest.md) |

#### Returns

`Promise`\<[`StructuredCompletionResponse`](../../../../../generated/cognition/types.gen/type-aliases/StructuredCompletionResponse.md)\>
