# Interface: MentionPart

The two things a mentionable entity contributes to a message.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-mention"></a> `mention` | [`SimpleMention`](../../../generated/storage/types.gen/type-aliases/SimpleMention.md) | The parallel entry the backend uses for notifications and permissions. |
| <a id="property-tag"></a> `tag` | `string` | The `<m-*>` tag written into the message content. |
