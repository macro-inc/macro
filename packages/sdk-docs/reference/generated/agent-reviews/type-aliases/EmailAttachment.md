# Type Alias: EmailAttachment

> **EmailAttachment** = \{ `documentId`: `string`; \}

A Macro document attached to an outgoing email as a file.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-documentid"></a> `documentId` | `string` | The id of the Macro document to attach. It must be a stored file - an uploaded PDF, image, spreadsheet, Word document, or other upload - that the user can view. A Macro-native document (one written in the editor) has no file to attach; link to it in the body instead. |
