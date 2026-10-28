# Type Alias: CursorModelOption

> **CursorModelOption** = \{ `displayName`: `string`; `group`: `string`; `id`: `string`; \}

One model the settings dropdown can offer.

Id, name and family: the dropdown lists models, not the hundreds of
parameter variants each carries. The chosen id's parameters are resolved to
Cursor's default variant at session start. The family is the same heading
the Cursor ACP agent groups its session model select under, so the settings
picker and the in-session picker read the same way.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-displayname"></a> `displayName` | `string` | The human-readable name, e.g. `Cursor Grok 4.6`. |
| <a id="property-group"></a> `group` | `string` | The family heading to list this model under, e.g. `Cursor Grok`. |
| <a id="property-id"></a> `id` | `string` | The id to store and send, e.g. `grok-4.6`. |
