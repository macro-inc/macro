# Type Alias: PipedreamTokenRequest

> **PipedreamTokenRequest** = \{ `app_slug?`: `string` \| `null`; \}

Request body for starting a connect flow.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-app_slug"></a> `app_slug?` | `string` \| `null` | The app to connect, by Pipedream slug. With it, an app Macro Connect serves can answer with a Connect URL instead of a Pipedream token. |
