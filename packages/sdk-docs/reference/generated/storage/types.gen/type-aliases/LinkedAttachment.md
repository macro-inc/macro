# Type Alias: LinkedAttachment

> **LinkedAttachment** = \{ `durationSeconds?`: `number` \| `null`; `fileId?`: `string` \| `null`; `fileName`: `string`; `height?`: `number` \| `null`; `mime`: `string`; `ordinal`: `number`; `presentation?`: `null` \| [`LinkedMediaPresentation`](LinkedMediaPresentation.md); `size`: `number`; `state`: [`LinkedAttachmentState`](LinkedAttachmentState.md); `width?`: `number` \| `null`; \}

One attachment of a linked message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-durationseconds"></a> `durationSeconds?` | `number` \| `null` | Length of audio or video in whole seconds, when declared. |
| <a id="property-fileid"></a> `fileId?` | `string` \| `null` | The static file holding it, once ready. |
| <a id="property-filename"></a> `fileName` | `string` | Display filename. |
| <a id="property-height"></a> `height?` | `number` \| `null` | Pixel height, when declared. |
| <a id="property-mime"></a> `mime` | `string` | Declared MIME type. |
| <a id="property-ordinal"></a> `ordinal` | `number` | Position within the message. |
| <a id="property-presentation"></a> `presentation?` | `null` \| [`LinkedMediaPresentation`](LinkedMediaPresentation.md) | - |
| <a id="property-size"></a> `size` | `number` | Declared size in bytes. |
| <a id="property-state"></a> `state` | [`LinkedAttachmentState`](LinkedAttachmentState.md) | Current state. |
| <a id="property-width"></a> `width?` | `number` \| `null` | Pixel width of an image, sticker or video, when WhatsApp declared it. |
