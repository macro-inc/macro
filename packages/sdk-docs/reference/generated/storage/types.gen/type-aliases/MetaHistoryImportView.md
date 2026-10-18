# Type Alias: MetaHistoryImportView

> **MetaHistoryImportView** = \{ `can_import`: `boolean`; `import?`: `null` \| [`MetaHistoryImport`](MetaHistoryImport.md); `reason?`: `string` \| `null`; \}

Server-authorized import affordance and current progress.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-can_import"></a> `can_import` | `boolean` | Whether the connector or administrator may start or resume an import now. |
| <a id="property-import"></a> `import?` | `null` \| [`MetaHistoryImport`](MetaHistoryImport.md) | - |
| <a id="property-reason"></a> `reason?` | `string` \| `null` | Explanation when unavailable; no credentials or provider response bodies. |
