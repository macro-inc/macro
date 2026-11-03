# Type Alias: DocumentEditsRequest

> **DocumentEditsRequest** = \{ `operations`: \{\[`key`: `string`\]: `unknown`; \}[]; \}

A batch of edit ops built against the document's structure.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-operations"></a> `operations` | \{\[`key`: `string`\]: `unknown`; \}[] | 1 to 200 ops, applied in order, all or nothing. Each is a `DocumentOp` from `@macro-inc/editor-ops`, the op vocabulary's source of truth. |
