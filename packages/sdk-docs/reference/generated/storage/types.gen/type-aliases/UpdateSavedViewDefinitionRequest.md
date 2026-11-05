# Type Alias: UpdateSavedViewDefinitionRequest

> **UpdateSavedViewDefinitionRequest** = \{ `config?`: \{\[`key`: `string`\]: `unknown`; \} \| `null`; `expectedRevision`: `number`; `name?`: `string` \| `null`; `sharing?`: `null` \| [`SavedViewSharingRequest`](SavedViewSharingRequest.md); \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-config"></a> `config?` | \{\[`key`: `string`\]: `unknown`; \} \| `null` | Complete replacement configuration; absent keeps the current one. |
| <a id="property-expectedrevision"></a> `expectedRevision` | `number` | Revision that must still be current when the update commits. |
| <a id="property-name"></a> `name?` | `string` \| `null` | Replacement name; absent keeps the current one. |
| <a id="property-sharing"></a> `sharing?` | `null` \| [`SavedViewSharingRequest`](SavedViewSharingRequest.md) | - |
