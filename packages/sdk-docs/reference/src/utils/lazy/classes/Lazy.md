# Class: Lazy\<T\>

A value fetched on first access and cached thereafter. Powers thin entity
handles: construction is free, the record is loaded lazily the first time a
field is read, and concurrent reads share one in-flight request. Pass a
`seed` when the record is already known (from a list or an event) to skip the
fetch entirely.

## Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t"></a> `T` |

## Constructors

### Constructor

> **new Lazy**\<`T`\>(`loader`, `seed?`): `Lazy`\<`T`\>

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `loader` | () => `Promise`\<`T`\> |
| `seed?` | `T` |

#### Returns

`Lazy`\<`T`\>

## Methods

### clear()

> **clear**(): `void`

Drop the cached value so the next read refetches.

#### Returns

`void`

***

### get()

> **get**(): `Promise`\<`T`\>

#### Returns

`Promise`\<`T`\>

***

### peek()

> **peek**(): `T` \| `undefined`

The cached value, if already loaded — never triggers a fetch.

#### Returns

`T` \| `undefined`
