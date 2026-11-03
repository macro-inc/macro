# Type Alias: DocumentEditUnacknowledged

> **DocumentEditUnacknowledged** = \{ `error`: [`DocumentEditUnacknowledgedCode`](DocumentEditUnacknowledgedCode.md); `message`: `string`; \}

The batch was sent to storage but never acknowledged, so it may have
applied. Read the document before retrying.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-error"></a> `error` | [`DocumentEditUnacknowledgedCode`](DocumentEditUnacknowledgedCode.md) | Always `unacknowledged`. |
| <a id="property-message"></a> `message` | `string` | What the editing worker reported. |
