# Interface: DocumentEditOptions

Options for `Document.edit`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-fast"></a> `fast?` | `boolean` | One fast model instead of the full pipeline: quicker and cheaper, for small, local edits such as a sentence or a list. |
| <a id="property-queries"></a> `queries?` | [`DatabaseQueryBlock`](../../../../vendor/editor-ops/src/document/document-editor/type-aliases/DatabaseQueryBlock.md)[] | Saved database questions to place, such as the `SavedQuery` a table's `saveQuery` returns. Their blocks are passed to the editor verbatim; say in the instructions where each goes and how to show it. The SQL never leaves the server. |
| <a id="property-signal"></a> `signal?` | `AbortSignal` | Cancels the edit end to end and rejects with `AbortError`. Ops already synced stay; the rest are discarded, so an aborted edit can be left part done. Read `structure()` to see what landed. |
