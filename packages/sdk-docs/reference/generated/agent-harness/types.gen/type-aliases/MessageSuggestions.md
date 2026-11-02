# Type Alias: MessageSuggestions

> **MessageSuggestions** = \{ `body?`: `string` \| `null`; `recipients?`: `string`[]; \}

Editable fields for message inference, before submission and identity resolution.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `string` \| `null` | Suggested Markdown content or outgoing message body. |
| <a id="property-recipients"></a> `recipients?` | `string`[] | Person or channel names for the client to resolve. |
