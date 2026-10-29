# Type Alias: EmailSuggestions

> **EmailSuggestions** = \{ `bcc?`: `string`[]; `body?`: `string` \| `null`; `cc?`: `string`[]; `recipients?`: `string`[]; `subject?`: `string` \| `null`; \}

Editable fields for email inference, before submission and identity resolution.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bcc"></a> `bcc?` | `string`[] | Explicit blind-carbon-copy recipient names or supplied email addresses. |
| <a id="property-body"></a> `body?` | `string` \| `null` | Suggested Markdown content or outgoing message body. |
| <a id="property-cc"></a> `cc?` | `string`[] | Explicit carbon-copy recipient names or supplied email addresses. |
| <a id="property-recipients"></a> `recipients?` | `string`[] | Person or channel names for the client to resolve. |
| <a id="property-subject"></a> `subject?` | `string` \| `null` | Suggested outgoing email subject. |
