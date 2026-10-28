# Type Alias: TeamInviteLinkTokenRequest

> **TeamInviteLinkTokenRequest** = \{ `token`: [`TeamInviteLinkToken`](TeamInviteLinkToken.md); \}

Identifies an invite link. The token travels in the body, not the path, so
request spans and access logs that record the path never see it.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-token"></a> `token` | [`TeamInviteLinkToken`](TeamInviteLinkToken.md) | The invite link's token. |
