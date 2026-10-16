# Type Alias: CreateGtmInviteLinkRequest

> **CreateGtmInviteLinkRequest** = \{ `firstName`: `string`; `note?`: `string` \| `null`; `recipientEmail?`: `string` \| `null`; \}

Request body to create a link.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-firstname"></a> `firstName` | `string` | The recipient's first name, shown on the welcome page. |
| <a id="property-note"></a> `note?` | `string` \| `null` | Free-form internal note for the dashboard. |
| <a id="property-recipientemail"></a> `recipientEmail?` | `string` \| `null` | The recipient's email, when the sender knows it. |
