# Interface: DocumentEditResult

What an instructions edit did.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-changedblocks"></a> `changedBlocks` | `string`[] | Durable ids of the blocks it changed or created, in the document's XML view. |
| <a id="property-clarification"></a> `clarification?` | `string` | Set when the editor applied part of the edit and stopped: what it needs to know to finish. The applied part stays; send only the rest. |
| <a id="property-revision"></a> `revision` | `string` | The document's version after the edit (base64 Loro version vector). |
| <a id="property-summary"></a> `summary` | `string` | What the editor changed, in words. |
| <a id="property-weburl"></a> `webUrl` | `string` | Link to the document in the Macro web app. |
