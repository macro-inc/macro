# Type Alias: Form

> **Form** = \{ `audience`: [`Audience`](Audience.md); `closesAt`: `string` \| `null`; `confirmationMessage`: `string`; `createdAt`: `string`; `databaseId`: `string`; `description`: `string`; `id`: `string`; `name`: `string`; `ownerId`: `string`; `respondentColumnId`: `string` \| `null`; `status`: [`FormStatus`](FormStatus.md); `submittedColumnId`: `string` \| `null`; `tableId`: `string`; `tallyVisible`: `boolean`; `updatedAt`: `string`; \}

A form: a view of one database table whose rows are its responses.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-audience"></a> `audience` | [`Audience`](Audience.md) | Who may respond. |
| <a id="property-closesat"></a> `closesAt` | `string` \| `null` | When it stops taking responses, if it does. |
| <a id="property-confirmationmessage"></a> `confirmationMessage` | `string` | What a respondent reads once their response is saved; empty for the default. |
| <a id="property-createdat"></a> `createdAt` | `string` | When it was created. |
| <a id="property-databaseid"></a> `databaseId` | `string` | The database holding its responses. |
| <a id="property-description"></a> `description` | `string` | What respondents read under the name. |
| <a id="property-id"></a> `id` | `string` | The form. |
| <a id="property-name"></a> `name` | `string` | Its display name. A standalone form follows the database it created; a form attached to an existing table has its own name. |
| <a id="property-ownerid"></a> `ownerId` | `string` | Its owner. |
| <a id="property-respondentcolumnid"></a> `respondentColumnId` | `string` \| `null` | The person column each signed-in submission names its respondent in; `null` once deleted. |
| <a id="property-status"></a> `status` | [`FormStatus`](FormStatus.md) | Whether its owner closed it. |
| <a id="property-submittedcolumnid"></a> `submittedColumnId` | `string` \| `null` | The date column each submission stamps; `null` once deleted. |
| <a id="property-tableid"></a> `tableId` | `string` | The table whose rows are its responses. |
| <a id="property-tallyvisible"></a> `tallyVisible` | `boolean` | Whether respondents may read option tallies. |
| <a id="property-updatedat"></a> `updatedAt` | `string` | When its facts or layout last changed. |
