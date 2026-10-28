# Type Alias: CreateTaskResponse

> **CreateTaskResponse** = \{ `documentId`: `string`; `documentMetadata`: [`DocumentResponseMetadata`](DocumentResponseMetadata.md); `initialSnapshot`: `string`; `teamId?`: `string` \| `null`; `teamTaskId?`: `number` \| `null`; `token`: `string`; \}

Response for creating a task.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-documentid"></a> `documentId` | `string` | The document ID of the created task. |
| <a id="property-documentmetadata"></a> `documentMetadata` | [`DocumentResponseMetadata`](DocumentResponseMetadata.md) | Metadata for the created document |
| <a id="property-initialsnapshot"></a> `initialSnapshot` | `string` | Base64-encoded canonical Loro snapshot used to initialize the task. |
| <a id="property-teamid"></a> `teamId?` | `string` \| `null` | The team this task number is scoped to. |
| <a id="property-teamtaskid"></a> `teamTaskId?` | `number` \| `null` | The task number assigned within the team. |
| <a id="property-token"></a> `token` | `string` | A pre-generated permission token that you can use for SS |
