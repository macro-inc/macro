# Interface: DocumentEditOptions

Options for `Document.edit`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-fast"></a> `fast?` | `boolean` | One fast model instead of the full pipeline: quicker and cheaper, for small, local edits such as a sentence or a list. |
| <a id="property-signal"></a> `signal?` | `AbortSignal` | Cancels the edit end to end and rejects with `AbortError`. What reached the document before the abort stays and nothing is applied after it; there is no rollback, so an aborted edit can be left part done, down to a sentence half retyped. Read `content()` to see what landed. |
