# Type Alias: GenerateImageRequest

> **GenerateImageRequest** = \{ `aspectRatio?`: `null` \| [`GenerateImageAspectRatio`](GenerateImageAspectRatio.md); `prompt`: `string`; `referenceImages?`: [`GenerateImageReference`](GenerateImageReference.md)[]; \}

What image to generate.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-aspectratio"></a> `aspectRatio?` | `null` \| [`GenerateImageAspectRatio`](GenerateImageAspectRatio.md) | - |
| <a id="property-prompt"></a> `prompt` | `string` | Description of the image: subject, style, composition, colours, and any text to render. |
| <a id="property-referenceimages"></a> `referenceImages?` | [`GenerateImageReference`](GenerateImageReference.md)[] | Up to three reference images, in the order the prompt refers to them. |
