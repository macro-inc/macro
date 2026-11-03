# Class: StaticImage

An image in static file storage: an upload, or one made with
`macro.images.generate()`. Attach it to a channel message with
`channel.send(text, { images: [image] })`, or pass it back to `generate` as
a reference.

## Extended by

- [`GeneratedImage`](GeneratedImage.md)

## Properties

| Property | Modifier | Type | Description |
| ------ | ------ | ------ | ------ |
| <a id="property-height"></a> `height?` | `readonly` | `number` | Intrinsic pixel height, when known. |
| <a id="property-id"></a> `id` | `readonly` | `string` | Static file id. |
| <a id="property-url"></a> `url` | `readonly` | `string` | Permanent URL of the image bytes. |
| <a id="property-width"></a> `width?` | `readonly` | `number` | Intrinsic pixel width, when known; lets messages reserve space. |

## Methods

### toJSON()

> **toJSON**(): \{ `height`: `number` \| `undefined`; `id`: `string`; `url`: `string`; `width`: `number` \| `undefined`; \}

Serialize the image reference without its client.

#### Returns

\{ `height`: `number` \| `undefined`; `id`: `string`; `url`: `string`; `width`: `number` \| `undefined`; \}

| Name | Type |
| ------ | ------ |
| `height` | `number` \| `undefined` |
| `id` | `string` |
| `url` | `string` |
| `width` | `number` \| `undefined` |

***

### byId()

> `static` **byId**(`client`, `id`, `size?`): `StaticImage`

A handle to an image already in static file storage. Pass `width` and
`height` when you know them, so a message reserves the image's space
before it loads.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |
| `id` | `string` |
| `size?` | \{ `height`: `number`; `width`: `number`; \} |
| `size.height` | `number` |
| `size.width` | `number` |

#### Returns

`StaticImage`
