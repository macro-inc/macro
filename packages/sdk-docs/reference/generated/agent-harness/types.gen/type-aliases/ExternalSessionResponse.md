# Type Alias: ExternalSessionResponse

> **ExternalSessionResponse** = \{ `name?`: `string` \| `null`; `provider`: `string`; `url?`: `string` \| `null`; \}

The provider-side identity of an externally-served session.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name?` | `string` \| `null` | The provider's display name for the agent, when it reported one. |
| <a id="property-provider"></a> `provider` | `string` | Which provider serves the session, e.g. `cursor`. |
| <a id="property-url"></a> `url?` | `string` \| `null` | The agent's page on the provider's site, for a client to link out to. |
