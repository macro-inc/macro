# Interface: ApplyEditsOptions

Options for [DocumentStructure.applyEdits](../classes/DocumentStructure.md#applyedits).

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-signal"></a> `signal?` | `AbortSignal` | Cancels the request. Aborted before the batch reaches the editor, nothing applies; after that, the batch lands whole or not at all and the call rejects with `AbortError`, so read the document before retrying. |
