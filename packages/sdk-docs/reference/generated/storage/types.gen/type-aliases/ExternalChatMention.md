# Type Alias: ExternalChatMention

> **ExternalChatMention** = [`ExternalChatPersonRef`](ExternalChatPersonRef.md) & \{ `token`: `string`; \}

An @-mention in a message body.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `token` | `string` | What follows the `@` in the body (WhatsApp: the digits of the person's id); replace `@<token>` with the name. |
