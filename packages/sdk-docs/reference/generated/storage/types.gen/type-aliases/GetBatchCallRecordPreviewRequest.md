# Type Alias: GetBatchCallRecordPreviewRequest

> **GetBatchCallRecordPreviewRequest** = \{ `callIds`: `string`[]; \}

Request body for `POST /call/record/preview`.

The `call_ids` list is bounded at [`MAX_BATCH_CALL_IDS`]; the handler
rejects anything larger with a 400 before touching the database.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-callids"></a> `callIds` | `string`[] | The call ids to preview. Duplicate ids are deduplicated server-side. Capped at [`MAX_BATCH_CALL_IDS`] entries. |
