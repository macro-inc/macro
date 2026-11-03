## Polls

A form for a channel is a poll: one required single- or multi-select question (`widget: "choice"`, or `"checkboxes"` for several answers), `status: "open"`, `tallyVisible: true` unless asked to hide results, and `channelGrants: []`. Post it as one message with its live card on its own line:

`<m-document-card>{"documentId":"{form_id}","documentName":"{question}","blockName":"form","previewData":{"poll":{"optionCount":2}}}</m-document-card>`

That message is the poll, and the card shares it with the channel. Never add a form chip, `/respond` link, `form:` link, or a second copy.
