# Type Alias: SharedInboxConflictResponse

> **SharedInboxConflictResponse** = \{ `email_address`: `string`; `existing_link_id`: `string`; `existing_owner_email`: `string`; \}

Returned with a `409 Conflict` when a connect targets an external mailbox another
macro user has already connected. The client surfaces a confirmation; on confirm it
retries `/email/init` with `force_share=true` to promote the mailbox to a shared inbox.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-email_address"></a> `email_address` | `string` | The mailbox address that is already connected. |
| <a id="property-existing_link_id"></a> `existing_link_id` | `string` | The existing link that would be shared if the caller confirms. |
| <a id="property-existing_owner_email"></a> `existing_owner_email` | `string` | The email of the macro user who first connected the mailbox. |
