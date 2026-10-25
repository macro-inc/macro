# Class: DevicePairing

Device side pairing identity. Keep the device secret outside the handle.

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` | Pairing identifier. |

## Methods

### claim()

> **claim**(`deviceSecret`): `Promise`\<\{ `harness`: [`Harness`](../../harness/classes/Harness.md); `token`: `string`; \} \| `undefined`\>

Attempt to claim an approved pairing. Pending claims return undefined.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `deviceSecret` | `string` |

#### Returns

`Promise`\<\{ `harness`: [`Harness`](../../harness/classes/Harness.md); `token`: `string`; \} \| `undefined`\>

***

### toJSON()

> **toJSON**(): \{ `id`: `string`; \}

Serialize identity only.

#### Returns

\{ `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `id` | `string` |

***

### byId()

> `static` **byId**(`client`, `id`): `DevicePairing`

Construct the device side handle.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |

#### Returns

`DevicePairing`
