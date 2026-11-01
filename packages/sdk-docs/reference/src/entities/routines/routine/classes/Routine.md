# Class: Routine

A scheduled or event-triggered agent task.

## Extends

- [`MacroEntity`](../../../entity/classes/MacroEntity.md)\<[`ScheduledActionResponse`](../../../../../generated/scheduled-action/types.gen/type-aliases/ScheduledActionResponse.md)\>

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-enabled"></a> `enabled` | `readonly` | () => `Promise`\<`boolean`\> | Whether the routine is enabled. | - |
| <a id="property-id"></a> `id` | `public readonly` | `string` | - | [`MacroEntity`](../../../entity/classes/MacroEntity.md).[`id`](../../../entity/classes/MacroEntity.md#property-id) |
| <a id="property-name"></a> `name` | `readonly` | () => `Promise`\<`string`\> | Routine name. | - |
| <a id="property-nextrunat"></a> `nextRunAt` | `readonly` | () => `Promise`\<`string` \| `undefined`\> | Next scheduled execution. | - |
| <a id="property-owner"></a> `owner` | `readonly` | () => `Promise`\<[`User`](../../../users/user/classes/User.md)\> | Routine owner. | - |
| <a id="property-revision"></a> `revision` | `readonly` | () => `Promise`\<`number`\> | Configuration revision. | - |
| <a id="property-runvisibility"></a> `runVisibility` | `readonly` | () => `Promise`\<[`RunVisibility`](../../../../../generated/scheduled-action/types.gen/type-aliases/RunVisibility.md)\> | Whether the routine's runs appear in Home and the Agents list. | - |
| <a id="property-sourcetemplate"></a> `sourceTemplate` | `readonly` | () => `Promise`\<`Routine` \| `undefined`\> | The shared routine whose template this routine was activated from. | - |
| <a id="property-trigger"></a> `trigger` | `readonly` | () => `Promise`\<[`ActionTrigger`](../../../../../generated/scheduled-action/types.gen/type-aliases/ActionTrigger.md)\> | Configured triggers. | - |

## Methods

### activateTemplate()

> **activateTemplate**(`options`): `Promise`\<`Routine`\>

Create the caller's own routine from this routine's shared template, with
its references already filled in for them.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`RoutineOptions`](../interfaces/RoutineOptions.md) |

#### Returns

`Promise`\<`Routine`\>

***

### delete()

> **delete**(): `Promise`\<`void`\>

Delete the routine.

#### Returns

`Promise`\<`void`\>

***

### execute()

> **execute**(): `Promise`\<[`AgentSession`](../../../agent-sessions/agent-session/classes/AgentSession.md) \| [`Chat`](../../../chats/chat/classes/Chat.md) \| `undefined`\>

Start an execution immediately and return its transcript handle if available.

#### Returns

`Promise`\<[`AgentSession`](../../../agent-sessions/agent-session/classes/AgentSession.md) \| [`Chat`](../../../chats/chat/classes/Chat.md) \| `undefined`\>

***

### history()

> **history**(): `Promise`\<[`RoutineExecution`](RoutineExecution.md)[]\>

Completed executions, with their routine scoped identity.

#### Returns

`Promise`\<[`RoutineExecution`](RoutineExecution.md)[]\>

***

### setEnabled()

> **setEnabled**(`enabled`): `Promise`\<`void`\>

Enable or disable triggering.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `enabled` | `boolean` |

#### Returns

`Promise`\<`void`\>

***

### shareAsTemplate()

> **shareAsTemplate**(`options`): `Promise`\<[`RoutineTemplate`](RoutineTemplate.md)\>

Share this routine as a template, or update its shared snapshot. People
get the template, never the routine, its runs or its results.

#### Parameters

| Parameter | Type | Description |
| ------ | ------ | ------ |
| `options` | \{ `description`: `string`; `variables`: [`TemplateVariable`](../../../../../generated/scheduled-action/types.gen/type-aliases/TemplateVariable.md)[]; \} | - |
| `options.description` | `string` | What the routine does for someone. |
| `options.variables` | [`TemplateVariable`](../../../../../generated/scheduled-action/types.gen/type-aliases/TemplateVariable.md)[] | How each user-specific reference fills in when someone activates it. |

#### Returns

`Promise`\<[`RoutineTemplate`](RoutineTemplate.md)\>

***

### stopSharingTemplate()

> **stopSharingTemplate**(): `Promise`\<`void`\>

Stop sharing this routine. Routines already activated keep running.

#### Returns

`Promise`\<`void`\>

***

### template()

> **template**(): `Promise`\<[`RoutineTemplate`](RoutineTemplate.md) \| `undefined`\>

This routine's shared template, or `undefined` when it isn't shared.

#### Returns

`Promise`\<[`RoutineTemplate`](RoutineTemplate.md) \| `undefined`\>

***

### toJSON()

> **toJSON**(): \{ `detail?`: [`ScheduledActionResponse`](../../../../../generated/scheduled-action/types.gen/type-aliases/ScheduledActionResponse.md); `id`: `string`; \}

#### Returns

\{ `detail?`: [`ScheduledActionResponse`](../../../../../generated/scheduled-action/types.gen/type-aliases/ScheduledActionResponse.md); `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `detail?` | [`ScheduledActionResponse`](../../../../../generated/scheduled-action/types.gen/type-aliases/ScheduledActionResponse.md) |
| `id` | `string` |

#### Inherited from

[`MacroEntity`](../../../entity/classes/MacroEntity.md).[`toJSON`](../../../entity/classes/MacroEntity.md#tojson)

***

### update()

> **update**(`options`): `Promise`\<`void`\>

Replace the routine's task and trigger configuration.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`RoutineOptions`](../interfaces/RoutineOptions.md) |

#### Returns

`Promise`\<`void`\>

***

### byId()

> `static` **byId**(`client`, `id`): `Routine`

Construct a lazy routine handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`Routine`

***

### from()

> `static` **from**(`client`, `record`): `Routine`

Seed a handle from a server record.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `record` | [`ScheduledActionResponse`](../../../../../generated/scheduled-action/types.gen/type-aliases/ScheduledActionResponse.md) |

#### Returns

`Routine`
