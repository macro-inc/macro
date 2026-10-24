# Type Alias: WhatsAppMention

> **WhatsAppMention** = [`WhatsAppPersonRef`](WhatsAppPersonRef.md) & \{ `token`: `string`; \}

An @-mention in a message body.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `token` | `string` | What follows the `@` in the body (the digits of the person's WhatsApp id); replace `@<token>` with the name. |
