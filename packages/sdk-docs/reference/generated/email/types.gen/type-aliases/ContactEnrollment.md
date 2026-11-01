# Type Alias: ContactEnrollment

> **ContactEnrollment** = \{ `isOwner`: `boolean`; `lastSentAt?`: `string` \| `null`; `nextSendAt?`: `string` \| `null`; `ownerId`: `string`; `reason?`: `null` \| [`EnrollmentReason`](EnrollmentReason.md); `sequenceId`: `string`; `sequenceName`: `string`; `sequencePaused`: `boolean`; `status`: [`EnrollmentStatus`](EnrollmentStatus.md); \}

A contact's enrollment as any teammate sees it: never step content.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-isowner"></a> `isOwner` | `boolean` | Whether the viewer owns the sequence. |
| <a id="property-lastsentat"></a> `lastSentAt?` | `string` \| `null` | When the last step was sent. |
| <a id="property-nextsendat"></a> `nextSendAt?` | `string` \| `null` | When the next step is scheduled or due. |
| <a id="property-ownerid"></a> `ownerId` | `string` | Macro user id of the sequence's owner. |
| <a id="property-reason"></a> `reason?` | `null` \| [`EnrollmentReason`](EnrollmentReason.md) | - |
| <a id="property-sequenceid"></a> `sequenceId` | `string` | Sequence id. |
| <a id="property-sequencename"></a> `sequenceName` | `string` | Sequence name. |
| <a id="property-sequencepaused"></a> `sequencePaused` | `boolean` | Whether the whole sequence is paused. |
| <a id="property-status"></a> `status` | [`EnrollmentStatus`](EnrollmentStatus.md) | Enrollment status. |
