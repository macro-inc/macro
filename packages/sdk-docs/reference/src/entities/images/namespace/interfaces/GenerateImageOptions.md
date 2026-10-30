# Interface: GenerateImageOptions

What image to generate.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-aspectratio"></a> `aspectRatio?` | [`GenerateImageAspectRatio`](../../../../../generated/cognition/types.gen/type-aliases/GenerateImageAspectRatio.md) | Shape of the image: `square` (1:1, the default), `landscape` (4:3), `portrait` (3:4), `widescreen` (16:9, banners and slides) or `tall` (9:16, phone screens and stories). |
| <a id="property-prompt"></a> `prompt` | `string` | Description of the image: subject, style (photo, illustration, flat vector...), composition, colours, mood, and any text that must appear. |
| <a id="property-referenceimages"></a> `referenceImages?` | ([`StaticImage`](../../image/classes/StaticImage.md) \| [`Document`](../../../documents/document/classes/Document.md))[] | Up to three images to edit or draw from, in the order the prompt refers to them ("image 1", "image 2"): image documents the caller can view, or static images such as an earlier generation or an attachment. |
