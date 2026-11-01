# Type Alias: Sequence

> **Sequence** = \{ `createdAt`: `string`; `footer`: `string`; `id`: `string`; `linkId?`: `string` \| `null`; `name`: `string`; `status`: [`SequenceStatus`](SequenceStatus.md); `steps`: [`Step`](Step.md)[]; `updatedAt`: `string`; `version`: `number`; \}

A sequence as its owner edits it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | When it was created. |
| <a id="property-footer"></a> `footer` | `string` | Line added above the unsubscribe link in every email. |
| <a id="property-id"></a> `id` | `string` | Sequence id. |
| <a id="property-linkid"></a> `linkId?` | `string` \| `null` | The owner's Gmail inbox it sends from. |
| <a id="property-name"></a> `name` | `string` | Display name. |
| <a id="property-status"></a> `status` | [`SequenceStatus`](SequenceStatus.md) | Lifecycle status. |
| <a id="property-steps"></a> `steps` | [`Step`](Step.md)[] | Step templates. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | When it last changed. |
| <a id="property-version"></a> `version` | `number` | Incremented by every change; edits must name the version they saw. |
