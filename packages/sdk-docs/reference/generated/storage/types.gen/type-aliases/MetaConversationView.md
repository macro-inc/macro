# Type Alias: MetaConversationView

> **MetaConversationView** = \{ `account_name`: `string`; `can_reply`: `boolean`; `capabilities`: [`ReplyCapabilities`](ReplyCapabilities.md); `conversation`: [`MetaConversation`](MetaConversation.md); `developer_account`: `boolean`; `eligibility`: [`ReplyEligibility`](ReplyEligibility.md); `health_error?`: `string` \| `null`; `human_agent_approved`: `boolean`; `media`: [`MetaMediaCapability`](MetaMediaCapability.md)[]; `provider`: [`MetaProvider`](MetaProvider.md); `sends`: [`MetaSendProgress`](MetaSendProgress.md)[]; `status`: [`MetaConnectionStatus`](MetaConnectionStatus.md); `text_limit`: `number`; `text_limit_in_bytes`: `boolean`; \}

Metadata rendered with an authorized native channel, without management secrets.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-account_name"></a> `account_name` | `string` | Business account shown beside the explicit send control. |
| <a id="property-can_reply"></a> `can_reply` | `boolean` | Current caller may deliberately reply through this account and channel. |
| <a id="property-capabilities"></a> `capabilities` | [`ReplyCapabilities`](ReplyCapabilities.md) | Implemented send operations and content limits. |
| <a id="property-conversation"></a> `conversation` | [`MetaConversation`](MetaConversation.md) | Persisted account-scoped customer identity. |
| <a id="property-developer_account"></a> `developer_account` | `boolean` | Whether this connection uses an explicitly configured developer number. |
| <a id="property-eligibility"></a> `eligibility` | [`ReplyEligibility`](ReplyEligibility.md) | Current account, user and provider eligibility, evaluated by the server. |
| <a id="property-health_error"></a> `health_error?` | `string` \| `null` | Sanitized account-health reason, so channel users see the correct recovery action. |
| <a id="property-human_agent_approved"></a> `human_agent_approved` | `boolean` | Server-observed eligibility for Instagram's human-support mode. |
| <a id="property-media"></a> `media` | [`MetaMediaCapability`](MetaMediaCapability.md)[] | Supported attachment types and effective size limits. |
| <a id="property-provider"></a> `provider` | [`MetaProvider`](MetaProvider.md) | Connected provider. |
| <a id="property-sends"></a> `sends` | [`MetaSendProgress`](MetaSendProgress.md)[] | Durable outbound intents including pending, unknown and failed replies. |
| <a id="property-status"></a> `status` | [`MetaConnectionStatus`](MetaConnectionStatus.md) | Connected/disconnected/recovery state. |
| <a id="property-text_limit"></a> `text_limit` | `number` | Maximum text units, counted by the provider's rule below. |
| <a id="property-text_limit_in_bytes"></a> `text_limit_in_bytes` | `boolean` | Instagram counts UTF-8 bytes; WhatsApp counts characters. |
