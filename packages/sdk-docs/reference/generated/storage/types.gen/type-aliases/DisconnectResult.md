# Type Alias: DisconnectResult

> **DisconnectResult** = \{ `remote_unsubscribed`: `boolean`; `shared_subscription_kept`: `boolean`; \}

Disconnect outcome; removing one phone must preserve a shared WABA subscription.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-remote_unsubscribed"></a> `remote_unsubscribed` | `boolean` | Meta confirmed removal of this app's subscription. |
| <a id="property-shared_subscription_kept"></a> `shared_subscription_kept` | `boolean` | Another connected account still needs the same provider subscription. |
