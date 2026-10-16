# Type Alias: CreatePipeline

> **CreatePipeline** = \{ `name`: `string`; `recordType`: [`PipelineRecordType`](PipelineRecordType.md); `sharing?`: [`PipelineSharing`](PipelineSharing.md); \}

Request to create an empty pipeline with the standard CRM columns.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-name"></a> `name` | `string` | Pipeline name. |
| <a id="property-recordtype"></a> `recordType` | [`PipelineRecordType`](PipelineRecordType.md) | Company or contact entries. |
| <a id="property-sharing"></a> `sharing?` | [`PipelineSharing`](PipelineSharing.md) | Defaults to private. |
