# Type Alias: EntityPermission

> **EntityPermission** = \{ `access_level`: [`AccessLevel`](AccessLevel.md); `type`: `"access_level"`; \} \| \{ `type`: `"channel_view_only"`; \} \| \{ `role`: [`ParticipantRole`](ParticipantRole.md); `type`: `"channel_role"`; \} \| \{ `role`: [`TeamRole`](TeamRole.md); `type`: `"team_role"`; \}

A user's permission for an entity, discriminated by entity kind.

Items (documents, chats, projects, threads) use access levels.
Channels use view-only permission or participant roles.

## Union Members

### Type Literal

\{ `access_level`: [`AccessLevel`](AccessLevel.md); `type`: `"access_level"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `access_level` | [`AccessLevel`](AccessLevel.md) | The access level the user has. |
| `type` | `"access_level"` | - |

***

### Type Literal

\{ `type`: `"channel_view_only"`; \}

***

### Type Literal

\{ `role`: [`ParticipantRole`](ParticipantRole.md); `type`: `"channel_role"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `role` | [`ParticipantRole`](ParticipantRole.md) | The role the user has in the channel. |
| `type` | `"channel_role"` | - |

***

### Type Literal

\{ `role`: [`TeamRole`](TeamRole.md); `type`: `"team_role"`; \}

| Name | Type | Description |
| ------ | ------ | ------ |
| `role` | [`TeamRole`](TeamRole.md) | The role the user has in the team. |
| `type` | `"team_role"` | - |
