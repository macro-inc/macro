# Class: RoutineExecution

A completed routine execution, as recorded by the service.

## Constructors

### Constructor

> **new RoutineExecution**(`routine`, `record`): `RoutineExecution`

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `routine` | [`Routine`](Routine.md) | Parent routine. |
| `record` | [`ActionExecutionRecord`](../../../../../generated/scheduled-action/types.gen/type-aliases/ActionExecutionRecord.md) | Execution snapshot. |

#### Returns

`RoutineExecution`

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-record"></a> `record` | `readonly` | [`ActionExecutionRecord`](../../../../../generated/scheduled-action/types.gen/type-aliases/ActionExecutionRecord.md) | Execution snapshot. |
| <a id="property-routine"></a> `routine` | `readonly` | [`Routine`](Routine.md) | Parent routine. |

## Accessors

### id

#### Get Signature

> **get** **id**(): `string` \| `undefined`

Execution identity, when assigned.

##### Returns

`string` \| `undefined`

## Methods

### toJSON()

> **toJSON**(): \{ `action_id`: `string`; `created_at`: `string`; `end_time`: `string`; `id?`: `string` \| `null`; `is_success`: `boolean`; `resource_id?`: `string` \| `null`; `result`: \{\[`key`: `string`\]: `unknown`; \}; `routine`: `string`; `start_time`: `string`; \}

Serialize without the authenticated client.

#### Returns

| Name | Type | Description |
| ------ | ------ | ------ |
| `action_id` | `string` | - |
| `created_at` | `string` | - |
| `end_time` | `string` | - |
| `id?` | `string` \| `null` | - |
| `is_success` | `boolean` | - |
| `resource_id?` | `string` \| `null` | ID of the primary resource produced by this run. Its type is recorded in `result`, independently of the routine's current configuration. |
| `result` | \{\[`key`: `string`\]: `unknown`; \} | - |
| `routine` | `string` | - |
| `start_time` | `string` | - |
