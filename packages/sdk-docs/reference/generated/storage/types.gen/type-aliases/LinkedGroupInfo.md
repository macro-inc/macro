# Type Alias: LinkedGroupInfo

> **LinkedGroupInfo** = \{ `announce`: `boolean`; `community`: `boolean`; `disappearing`: `boolean`; `group?`: `null` \| [`LinkedGroupReference`](LinkedGroupReference.md); `jid`: `string`; `name`: `string`; `observedAt`: `string`; `participants`: [`LinkedParticipant`](LinkedParticipant.md)[]; `shared?`: `null` \| [`LinkedSharedGroupReference`](LinkedSharedGroupReference.md); \}

One full metadata read of a group, never an incomplete membership delta.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-announce"></a> `announce` | `boolean` | Only admins may post. |
| <a id="property-community"></a> `community` | `boolean` | Community announcement or parent group, outside the supported surface. |
| <a id="property-disappearing"></a> `disappearing` | `boolean` | Disappearing messages are on; content is not retained. |
| <a id="property-group"></a> `group?` | `null` \| [`LinkedGroupReference`](LinkedGroupReference.md) | - |
| <a id="property-jid"></a> `jid` | `string` | Remote group JID. |
| <a id="property-name"></a> `name` | `string` | Current subject. |
| <a id="property-observedat"></a> `observedAt` | `string` | When the session service read this metadata. |
| <a id="property-participants"></a> `participants` | [`LinkedParticipant`](LinkedParticipant.md)[] | Full roster. |
| <a id="property-shared"></a> `shared?` | `null` \| [`LinkedSharedGroupReference`](LinkedSharedGroupReference.md) | - |
