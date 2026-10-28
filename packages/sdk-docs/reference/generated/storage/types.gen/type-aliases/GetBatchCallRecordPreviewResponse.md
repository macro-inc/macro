# Type Alias: GetBatchCallRecordPreviewResponse

> **GetBatchCallRecordPreviewResponse** = \{ `previews`: [`CallRecordPreview`](CallRecordPreview.md)[]; \}

Response body for `POST /call/record/preview`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-previews"></a> `previews` | [`CallRecordPreview`](CallRecordPreview.md)[] | One entry per deduplicated input id. |
