# Class: FormReference

A typed reference read from a form answer, without fetching the referenced entity.

## Implements

- [`FormEntityHandle`](../interfaces/FormEntityHandle.md)

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-entitytype"></a> `entityType` | `readonly` | [`EntityKind`](../../../../../generated/storage/types.gen/type-aliases/EntityKind.md) | The referenced entity's kind. |
| <a id="property-id"></a> `id` | `readonly` | `string` | The referenced entity's identifier. |

## Methods

### byId()

> `static` **byId**(`entityType`, `id`): `FormReference`

Construct a reference when its kind and identifier are known.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `entityType` | [`EntityKind`](../../../../../generated/storage/types.gen/type-aliases/EntityKind.md) |
| `id` | `string` |

#### Returns

`FormReference`
