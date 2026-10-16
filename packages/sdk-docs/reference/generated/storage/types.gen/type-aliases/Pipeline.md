# Type Alias: Pipeline

> **Pipeline** = \{ `createdAt`: `string`; `databaseId`: `string`; `id`: `string`; `name`: `string`; `primaryColumnId`: `string`; `recordType`: [`PipelineRecordType`](PipelineRecordType.md); `sharing`: [`PipelineSharing`](PipelineSharing.md); `tableId`: `string`; `teamId`: `string`; `trashedAt`: `string` \| `null`; `userId`: `string`; \}

Pipeline metadata; table schema and data are read through the database service.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-createdat"></a> `createdAt` | `string` | Creation time. |
| <a id="property-databaseid"></a> `databaseId` | `string` | Dedicated backing database. |
| <a id="property-id"></a> `id` | `string` | Entity identity, used with `CrmPipeline` access receipts. |
| <a id="property-name"></a> `name` | `string` | Pipeline display name. |
| <a id="property-primarycolumnid"></a> `primaryColumnId` | `string` | Protected primary column. |
| <a id="property-recordtype"></a> `recordType` | [`PipelineRecordType`](PipelineRecordType.md) | Kind of the primary reference. |
| <a id="property-sharing"></a> `sharing` | [`PipelineSharing`](PipelineSharing.md) | Whether the pipeline has a team grant. |
| <a id="property-tableid"></a> `tableId` | `string` | Table of entries. |
| <a id="property-teamid"></a> `teamId` | `string` | Team owning the pipeline; references retain their own access controls. |
| <a id="property-trashedat"></a> `trashedAt` | `string` \| `null` | Trashed pipelines are omitted from navigation. |
| <a id="property-userid"></a> `userId` | `string` | Owning user; sharing never changes ownership. |
