# Class: ChannelPicture

An uploaded channel profile picture in static file storage.

## Properties

| Property | Modifier | Type |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `readonly` | `string` |

## Methods

### toJSON()

> **toJSON**(): \{ `id`: `string`; \}

Serialize the uploaded picture reference.

#### Returns

\{ `id`: `string`; \}

| Name | Type |
| ------ | ------ |
| `id` | `string` |

***

### byId()

> `static` **byId**(`id`): `ChannelPicture`

Construct a reference from the upload receipt.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `id` | `string` |

#### Returns

`ChannelPicture`
