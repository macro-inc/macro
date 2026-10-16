# Type Alias: ReviewEmailDraft

> **ReviewEmailDraft** = \{ `attachments?`: \{ `documentId`: `string`; \}[]; `bcc?`: \{ `email`: `string`; `name?`: `string` \| `null`; \}[]; `body`: `string`; `cc?`: \{ `email`: `string`; `name?`: `string` \| `null`; \}[]; `includeSignature?`: `boolean` \| `null`; `replyingToId?`: `string` \| `null`; `subject`: `string`; `to`: \{ `email`: `string`; `name?`: `string` \| `null`; \}[]; \}

Markdown is rendered by the ordinary email action; the UI can edit each draft.

## Properties

| Property | Type |
| ------ | ------ |
| <a id="property-attachments"></a> `attachments?` | \{ `documentId`: `string`; \}[] |
| <a id="property-bcc"></a> `bcc?` | \{ `email`: `string`; `name?`: `string` \| `null`; \}[] |
| <a id="property-body"></a> `body` | `string` |
| <a id="property-cc"></a> `cc?` | \{ `email`: `string`; `name?`: `string` \| `null`; \}[] |
| <a id="property-includesignature"></a> `includeSignature?` | `boolean` \| `null` |
| <a id="property-replyingtoid"></a> `replyingToId?` | `string` \| `null` |
| <a id="property-subject"></a> `subject` | `string` |
| <a id="property-to"></a> `to` | \{ `email`: `string`; `name?`: `string` \| `null`; \}[] |
