# Type Alias: DocumentEditRejected

> **DocumentEditRejected** = \{ `error`: [`DocumentEditRejectedCode`](DocumentEditRejectedCode.md); `failures`: [`DocumentOpFailure`](DocumentOpFailure.md)[]; \}

Ops that failed against the live document; nothing was committed.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-error"></a> `error` | [`DocumentEditRejectedCode`](DocumentEditRejectedCode.md) | Always `edit_rejected`. |
| <a id="property-failures"></a> `failures` | [`DocumentOpFailure`](DocumentOpFailure.md)[] | Each op that failed, by its index in the batch. |
