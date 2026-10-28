# Type Alias: InboxReauthRequiredMetadata

> **InboxReauthRequiredMetadata** = \{ `emailAddress`: `string`; \}

Metadata for a notification that a linked inbox's grant has died and the
inbox must be reconnected. Fanned out to the inbox owner and every delegate,
since any of them holding the Google grant can restore sync.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-emailaddress"></a> `emailAddress` | `string` | The address of the inbox that needs to be reconnected. |
