# Type Alias: PostActivityRequest

> **PostActivityRequest** = \{ `activity_type`: [`ActivityType`](ActivityType.md); `channel_id`: `string`; \}

Request body for `POST /channels/activity`.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-activity_type"></a> `activity_type` | [`ActivityType`](ActivityType.md) | The kind of activity to record. |
| <a id="property-channel_id"></a> `channel_id` | `string` | Channel id to record activity for. |
