# Type Alias: LinkedGroupInfo

> **LinkedGroupInfo** = \{ `announce`: `boolean`; `communityAnnouncements?`: `boolean`; `communityJid?`: `string` \| `null`; `communityParent?`: `boolean`; `disappearingSeconds?`: `number` \| `null`; `group?`: `null` \| [`LinkedGroupReference`](LinkedGroupReference.md); `jid`: `string`; `name`: `string`; `observedAt`: `string`; `participants`: [`LinkedParticipant`](LinkedParticipant.md)[]; `shared?`: `null` \| [`LinkedSharedGroupReference`](LinkedSharedGroupReference.md); \}

One full metadata read of a group, never an incomplete membership delta.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-announce"></a> `announce` | `boolean` | Only admins may post. |
| <a id="property-communityannouncements"></a> `communityAnnouncements?` | `boolean` | The community's announcement group (everyone reads, admins post). |
| <a id="property-communityjid"></a> `communityJid?` | `string` \| `null` | The community a linked subgroup or announcement group belongs to. |
| <a id="property-communityparent"></a> `communityParent?` | `boolean` | The community itself: it has no messages of its own and can't be added. |
| <a id="property-disappearingseconds"></a> `disappearingSeconds?` | `number` \| `null` | Disappearing-messages timer in seconds while it is on. Macro keeps the messages; its sends carry the timer so phones treat them like their own. |
| <a id="property-group"></a> `group?` | `null` \| [`LinkedGroupReference`](LinkedGroupReference.md) | - |
| <a id="property-jid"></a> `jid` | `string` | Remote group JID. |
| <a id="property-name"></a> `name` | `string` | Current subject. |
| <a id="property-observedat"></a> `observedAt` | `string` | When the session service read this metadata. |
| <a id="property-participants"></a> `participants` | [`LinkedParticipant`](LinkedParticipant.md)[] | Full roster. |
| <a id="property-shared"></a> `shared?` | `null` \| [`LinkedSharedGroupReference`](LinkedSharedGroupReference.md) | - |
