# Type Alias: FormCollaboration

> **FormCollaboration** = \{ `detail`: [`FormDetail`](FormDetail.md); `publicationError?`: [`FormPublicationProblem`](FormPublicationProblem.md); \}

A ready collaborative form and the result of publishing its latest draft.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-detail"></a> `detail` | [`FormDetail`](FormDetail.md) | The latest validated form. The form id also identifies its surface. |
| <a id="property-publicationerror"></a> `publicationError?` | [`FormPublicationProblem`](FormPublicationProblem.md) | Why the current draft cannot yet replace the respondent layout. Only editors can request this result. |
