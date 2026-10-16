# Type Alias: EditQueuedActionRequest

> **EditQueuedActionRequest** = \{ `prompt`: `string`; \}

Request body for editing a queued prompt.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-prompt"></a> `prompt` | `string` | The new raw prompt text, replacing the old wholesale. Never blank: a prompt with nothing to say is a removal, and there is an endpoint for that. |
