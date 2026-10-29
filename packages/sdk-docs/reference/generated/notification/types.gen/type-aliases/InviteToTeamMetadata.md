# Type Alias: InviteToTeamMetadata

> **InviteToTeamMetadata** = \{ `invitedBy`: `string`; `inviteePlan?`: [`InviteePlan`](InviteePlan.md); `reminder?`: `boolean`; `role?`: `string` \| `null`; `senderProfilePictureUrl?`: `string` \| `null`; `teamId`: `string`; `teamInviteId`: `string`; `teamName`: `string`; \}

Metadata for when a user is invited to a team.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-invitedby"></a> `invitedBy` | `string` | The user who sent the invitation |
| <a id="property-inviteeplan"></a> `inviteePlan?` | [`InviteePlan`](InviteePlan.md) | What the invitee gets by joining, as the team stood when the invite was sent. |
| <a id="property-reminder"></a> `reminder?` | `boolean` | Whether this email reminds the invitee of an invite they have not answered. |
| <a id="property-role"></a> `role?` | `string` \| `null` | Role/permission level in the team |
| <a id="property-senderprofilepictureurl"></a> `senderProfilePictureUrl?` | `string` \| `null` | The sender's profile picture URL, if available. |
| <a id="property-teamid"></a> `teamId` | `string` | The unique identifier of the team |
| <a id="property-teaminviteid"></a> `teamInviteId` | `string` | The unique identifier of the team invite |
| <a id="property-teamname"></a> `teamName` | `string` | The name of the team being invited to |
