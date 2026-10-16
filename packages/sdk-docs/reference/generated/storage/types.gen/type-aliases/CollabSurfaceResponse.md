# Type Alias: CollabSurfaceResponse

> **CollabSurfaceResponse** = \{ `id`: `string`; `parentEntityId`: `string`; `parentEntityType`: `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"`; `state`: [`SurfaceState`](SurfaceState.md); \}

A collab surface, as returned by the API.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-id"></a> `id` | `string` | The surface id — also the sync-service session key. |
| <a id="property-parententityid"></a> `parentEntityId` | `string` | Id of the parent entity. |
| <a id="property-parententitytype"></a> `parentEntityType` | `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"` | Type of the parent entity. |
| <a id="property-state"></a> `state` | [`SurfaceState`](SurfaceState.md) | Lifecycle state (`ready` for every surface visible via the API). |
