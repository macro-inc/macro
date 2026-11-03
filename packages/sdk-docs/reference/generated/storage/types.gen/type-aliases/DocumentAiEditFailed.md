# Type Alias: DocumentAiEditFailed

> **DocumentAiEditFailed** = \{ `error`: [`DocumentAiEditFailedCode`](DocumentAiEditFailedCode.md); `message`: `string`; \}

The edit failed after it started, so it may have partly applied. Read the
document before retrying.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-error"></a> `error` | [`DocumentAiEditFailedCode`](DocumentAiEditFailedCode.md) | Always `edit_failed`. |
| <a id="property-message"></a> `message` | `string` | What went wrong. |
