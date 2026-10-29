# Type Alias: ExternalChatParticipant

> **ExternalChatParticipant** = \{ `admin`: `boolean`; `alternateJid?`: `string` \| `null`; `displayName?`: `string` \| `null`; `jid`: `string`; \}

Someone in an external chat; Macro access is a separate grant.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-admin"></a> `admin` | `boolean` | Group admin. |
| <a id="property-alternatejid"></a> `alternateJid?` | `string` \| `null` | The other address the provider verified for them. |
| <a id="property-displayname"></a> `displayName?` | `string` \| `null` | Their name at the provider, untrusted. |
| <a id="property-jid"></a> `jid` | `string` | Their id at the provider (WhatsApp: phone-number or LID JID). |
