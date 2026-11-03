# Type Alias: DocumentAiEditRefused

> **DocumentAiEditRefused** = \{ `error`: [`DocumentAiEditRefusedCode`](DocumentAiEditRefusedCode.md); `reason`: `string`; \}

The editor could not do the edit; nothing changed.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-error"></a> `error` | [`DocumentAiEditRefusedCode`](DocumentAiEditRefusedCode.md) | Always `edit_refused`. |
| <a id="property-reason"></a> `reason` | `string` | Why, in the editor's words: what it needs to know or cannot do. |
