# Type Alias: DocumentEditorOptions

> **DocumentEditorOptions** = \{ `refs`: `string`[]; `validIds`: `Iterable`\<[`NodeId`](../../ops/type-aliases/NodeId.md)\>; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-refs"></a> `refs` | `string`[] | A pool of globally-unique ids the host pre-generated (the sandbox has no good entropy of its own). Each insert pops one and stamps it as the new node's durable id, so inserted ids never collide — across concurrent writers, repeated runs, or sessions. |
| <a id="property-validids"></a> `validIds` | `Iterable`\<[`NodeId`](../../ops/type-aliases/NodeId.md)\> | Durable ids present in the document the model was shown. |
