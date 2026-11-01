# Type Alias: SoupEnrichedEmailThreadPreviewSoupPropertiesField

> **SoupEnrichedEmailThreadPreviewSoupPropertiesField** = [`SoupEmailThreadPreview`](SoupEmailThreadPreview.md) & \{ `properties`: [`SoupProperty`](SoupProperty.md)[]; \} & \{ `attachments`: [`SoupAttachment`](SoupAttachment.md)[]; `labels`: [`SoupLabel`](SoupLabel.md)[]; `participants`: [`SoupContact`](SoupContact.md)[]; \}

Email thread preview enriched with related metadata for Soup.

## Type Declaration

| Name | Type | Description |
| ------ | ------ | ------ |
| `properties` | [`SoupProperty`](SoupProperty.md)[] | Properties attached to the entity. |

| Name | Type | Description |
| ------ | ------ | ------ |
| `attachments` | [`SoupAttachment`](SoupAttachment.md)[] | Attachments on the thread. |
| `labels` | [`SoupLabel`](SoupLabel.md)[] | Labels attached to the thread. |
| `participants` | [`SoupContact`](SoupContact.md)[] | Contacts participating in the thread. |
