# Type Alias: AgentSessionPreviewData

> **AgentSessionPreviewData** = \{ `bot?`: `null` \| [`SessionBot`](SessionBot.md); `botId`: `string`; `createdAt`: `string`; `id`: `string`; `modifiedAt`: `string`; `name`: `string`; `ownerId`: `string`; `status`: [`SessionStatusDto`](SessionStatusDto.md); \}

The fields a chip renders for a session the caller may view.

Clients deserialize this, so both derives are used.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-bot"></a> `bot?` | `null` \| [`SessionBot`](SessionBot.md) | - |
| <a id="property-botid"></a> `botId` | `string` | The bot running the agent. |
| <a id="property-createdat"></a> `createdAt` | `string` | When the session was created. |
| <a id="property-id"></a> `id` | `string` | The session id. |
| <a id="property-modifiedat"></a> `modifiedAt` | `string` | When the session was last modified. |
| <a id="property-name"></a> `name` | `string` | User-facing session name. |
| <a id="property-ownerid"></a> `ownerId` | `string` | The user who owns the session. |
| <a id="property-status"></a> `status` | [`SessionStatusDto`](SessionStatusDto.md) | The session's last known status. |
