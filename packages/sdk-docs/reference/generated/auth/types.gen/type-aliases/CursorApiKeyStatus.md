# Type Alias: CursorApiKeyStatus

> **CursorApiKeyStatus** = \{ `defaultModelId?`: `string` \| `null`; `registered`: `boolean`; `updatedAt?`: `string` \| `null`; \}

What settings needs to render the Cursor connection.

Deliberately thin. `registered` drives the whole UI; `updatedAt` lets it say
when the key was last replaced, which is the only thing a user can check
against their own memory when a session starts failing.

Deliberately *not* reporting anything about the deployment itself. That is
operator information: a user who sees it cannot act on it, and a service
that cannot reach KMS does not start.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-defaultmodelid"></a> `defaultModelId?` | `string` \| `null` | The Cursor model id this user's sessions start on, when they have chosen one. `None` means the deployment default is in effect — the settings dropdown shows that as its resting value. |
| <a id="property-registered"></a> `registered` | `boolean` | Whether this user has a key stored. |
| <a id="property-updatedat"></a> `updatedAt?` | `string` \| `null` | When the stored key was last replaced, if there is one. |
