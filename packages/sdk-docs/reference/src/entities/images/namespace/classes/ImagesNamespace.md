# Class: ImagesNamespace

Image generation, charged to the acting user's AI allowance.

## Constructors

### Constructor

> **new ImagesNamespace**(`client`): `ImagesNamespace`

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `client` | `MacroClient` |

#### Returns

`ImagesNamespace`

## Methods

### generate()

> **generate**(`options`): `Promise`\<[`GeneratedImage`](../../image/classes/GeneratedImage.md)\>

Generate or edit an image with Google's Nano Banana model and store it as
a static file. Takes several seconds. Post it with
`channel.send(text, { images: [image] })`; the returned width and height
let the message reserve space before the image loads.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `options` | [`GenerateImageOptions`](../interfaces/GenerateImageOptions.md) |

#### Returns

`Promise`\<[`GeneratedImage`](../../image/classes/GeneratedImage.md)\>

#### Example

```ts
const image = await macro.images.generate({
  prompt: 'A watercolor lighthouse at dusk',
  aspectRatio: 'widescreen',
});
await channel.send('Fresh off the press', { images: [image] });
```
