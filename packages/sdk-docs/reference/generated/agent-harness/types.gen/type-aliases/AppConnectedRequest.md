# Type Alias: AppConnectedRequest

> **AppConnectedRequest** = \{ `actionId?`: `null` \| [`AgentActionId`](AgentActionId.md); `appSlug`: `string`; \}

Request body for reporting a connected app.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-actionid"></a> `actionId?` | `null` \| [`AgentActionId`](AgentActionId.md) | - |
| <a id="property-appslug"></a> `appSlug` | `string` | The Pipedream app slug the owner connected, e.g. `notion`. |
