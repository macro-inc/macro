# Class: GeneratedImage

An image made by `macro.images.generate()`, stored as a static file.

## Extends

- [`StaticImage`](StaticImage.md)

## Properties

| Property | Modifier | Type | Description | Inherited from |
| ------ | ------ | ------ | ------ | ------ |
| <a id="property-height"></a> `height` | `readonly` | `number` | Intrinsic pixel height. | [`StaticImage`](StaticImage.md).[`height`](StaticImage.md#property-height) |
| <a id="property-id"></a> `id` | `readonly` | `string` | Static file id. | [`StaticImage`](StaticImage.md).[`id`](StaticImage.md#property-id) |
| <a id="property-mimetype"></a> `mimeType` | `readonly` | `string` | IANA media type, e.g. `image/png`. | - |
| <a id="property-note"></a> `note?` | `readonly` | `string` | Commentary the model returned alongside the image, if any. | - |
| <a id="property-sizebytes"></a> `sizeBytes` | `readonly` | `number` | Size of the image in bytes. | - |
| <a id="property-url"></a> `url` | `readonly` | `string` | Permanent URL of the image bytes. | [`StaticImage`](StaticImage.md).[`url`](StaticImage.md#property-url) |
| <a id="property-width"></a> `width` | `readonly` | `number` | Intrinsic pixel width. | [`StaticImage`](StaticImage.md).[`width`](StaticImage.md#property-width) |

## Methods

### toJSON()

> **toJSON**(): \{ `height`: `number` \| `undefined`; `id`: `string`; `mimeType`: `string`; `note`: `string` \| `undefined`; `sizeBytes`: `number`; `url`: `string`; `width`: `number` \| `undefined`; \}

Serialize the generated image without its client.

#### Returns

\{ `height`: `number` \| `undefined`; `id`: `string`; `mimeType`: `string`; `note`: `string` \| `undefined`; `sizeBytes`: `number`; `url`: `string`; `width`: `number` \| `undefined`; \}

| Name | Type |
| ------ | ------ |
| `height` | `number` \| `undefined` |
| `id` | `string` |
| `mimeType` | `string` |
| `note` | `string` \| `undefined` |
| `sizeBytes` | `number` |
| `url` | `string` |
| `width` | `number` \| `undefined` |

#### Overrides

[`StaticImage`](StaticImage.md).[`toJSON`](StaticImage.md#tojson)

***

### byId()

> `static` **byId**(`client`, `id`, `size?`): [`StaticImage`](StaticImage.md)

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

[`StaticImage`](StaticImage.md)

#### Inherited from

[`StaticImage`](StaticImage.md).[`byId`](StaticImage.md#byid)
