# Type Alias: EnrollmentSummary

> **EnrollmentSummary** = \{ `contactName?`: `string` \| `null`; `createdAt`: `string`; `crmContactId?`: `string` \| `null`; `email`: `string`; `id`: `string`; `lastSentAt?`: `string` \| `null`; `nextSendAt?`: `string` \| `null`; `nextStep`: `number`; `reason?`: `null` \| [`EnrollmentReason`](EnrollmentReason.md); `status`: [`EnrollmentStatus`](EnrollmentStatus.md); `stepCount`: `number`; \}

One contact's progress through a sequence.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-contactname"></a> `contactName?` | `string` \| `null` | Name at enrollment. |
| <a id="property-createdat"></a> `createdAt` | `string` | When it was enrolled. |
| <a id="property-crmcontactid"></a> `crmContactId?` | `string` \| `null` | The CRM person enrolled; gone if the contact was deleted. |
| <a id="property-email"></a> `email` | `string` | Address the steps go to. |
| <a id="property-id"></a> `id` | `string` | Enrollment id. |
| <a id="property-lastsentat"></a> `lastSentAt?` | `string` \| `null` | When the last step was sent. |
| <a id="property-nextsendat"></a> `nextSendAt?` | `string` \| `null` | When the next step is scheduled or due. |
| <a id="property-nextstep"></a> `nextStep` | `number` | Index of the next step to send. |
| <a id="property-reason"></a> `reason?` | `null` \| [`EnrollmentReason`](EnrollmentReason.md) | - |
| <a id="property-status"></a> `status` | [`EnrollmentStatus`](EnrollmentStatus.md) | Status. |
| <a id="property-stepcount"></a> `stepCount` | `number` | Number of steps. |
