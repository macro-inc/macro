# Class: SystemSkill

A built-in system skill: static, code-defined AI instructions that surface
to AI like skill documents but have no document behind them. System skills
cannot be opened, edited, or deleted; reference them in AI inputs by id the
same way as skill documents.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` | The well-known id the skill is referenced by in mentions and AI tools. |
| <a id="property-name"></a> `name` | `readonly` | `string` | The skill's display name. |

## Methods

### list()

> `static` **list**(`client`): `Promise`\<`SystemSkill`[]\>

The built-in system skills, in display order.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`Promise`\<`SystemSkill`[]\>
