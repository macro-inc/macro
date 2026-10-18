# Type Alias: MetaCreateGroup

> **MetaCreateGroup** = \{ `channel_id`: `string`; `subject`: `string`; \}

Human request to create a private native channel and its WhatsApp group.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channel_id"></a> `channel_id` | `string` | Client-retained native identity, also used after a lost HTTP response. |
| <a id="property-subject"></a> `subject` | `string` | WhatsApp subject (1–128 characters). |
