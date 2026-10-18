# Type Alias: MetaBeginAuthorization

> **MetaBeginAuthorization** = \{ `browser_transaction?`: `string` \| `null`; `configuration`: [`MetaPublicConfiguration`](MetaPublicConfiguration.md); `state`: `string`; \}

Browser OAuth initiation result. State is scoped to the authenticated initiator.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-browser_transaction"></a> `browser_transaction?` | `string` \| `null` | Secret proof retained only by the initiating Instagram window; never sent to Meta. |
| <a id="property-configuration"></a> `configuration` | [`MetaPublicConfiguration`](MetaPublicConfiguration.md) | Public SDK/login configuration. |
| <a id="property-state"></a> `state` | `string` | Random anti-CSRF state echoed through the callback. |
