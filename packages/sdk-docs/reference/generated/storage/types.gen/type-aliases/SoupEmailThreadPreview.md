# Type Alias: SoupEmailThreadPreview

> **SoupEmailThreadPreview** = \{ `createdAt`: `string`; `id`: `string`; `inboxVisible`: `boolean`; `isDraft`: `boolean`; `isImportant`: `boolean`; `isRead`: `boolean`; `isSignal`: `boolean`; `name?`: `string` \| `null`; `ownerId`: `string`; `projectId?`: `string` \| `null`; `providerId?`: `string` \| `null`; `senderEmail?`: `string` \| `null`; `senderName?`: `string` \| `null`; `senderPhotoUrl?`: `string` \| `null`; `snippet?`: `string` \| `null`; `sortTs`: `string`; `updatedAt`: `string`; `viewedAt?`: `string` \| `null`; \}

Email thread preview data as displayed in Soup.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | Timestamp when the thread was created. |
| <a id="property-id"></a> `id` | `string` | Thread id. |
| <a id="property-inboxvisible"></a> `inboxVisible` | `boolean` | Whether the thread should appear in the inbox. |
| <a id="property-isdraft"></a> `isDraft` | `boolean` | Whether the thread contains a draft. |
| <a id="property-isimportant"></a> `isImportant` | `boolean` | Whether the thread is marked important. |
| <a id="property-isread"></a> `isRead` | `boolean` | Whether the thread has been read. |
| <a id="property-issignal"></a> `isSignal` | `boolean` | The denormalized `email_threads.is_signal` importance classification — the same flag the soup Importance filter evaluates, distinct from `is_important` (Gmail's IMPORTANT label). |
| <a id="property-name"></a> `name?` | `string` \| `null` | Thread display name or subject. |
| <a id="property-ownerid"></a> `ownerId` | `string` | Owner user id. |
| <a id="property-projectid"></a> `projectId?` | `string` \| `null` | Project id associated with the thread. |
| <a id="property-providerid"></a> `providerId?` | `string` \| `null` | Provider-specific thread id. |
| <a id="property-senderemail"></a> `senderEmail?` | `string` \| `null` | Sender email address for the preview. |
| <a id="property-sendername"></a> `senderName?` | `string` \| `null` | Sender display name for the preview. |
| <a id="property-senderphotourl"></a> `senderPhotoUrl?` | `string` \| `null` | Sender photo URL for the preview. |
| <a id="property-snippet"></a> `snippet?` | `string` \| `null` | Thread snippet. |
| <a id="property-sortts"></a> `sortTs` | `string` | Timestamp used for email thread sorting. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | Timestamp when the thread was last updated. |
| <a id="property-viewedat"></a> `viewedAt?` | `string` \| `null` | Timestamp when the requesting user last viewed the thread. |
