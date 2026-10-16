# Type Alias: EnsureCollabSurfaceRequest

> **EnsureCollabSurfaceRequest** = \{ `initialMarkdown?`: `string`; `parentEntityId`: `string`; `parentEntityType`: `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"`; \}

Request body for ensuring a collab surface.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-initialmarkdown"></a> `initialMarkdown?` | `string` | Markdown to seed the surface with when this ensure creates it. Empty (or omitted) seeds the canonical blank document. Ignored when the surface already exists and is ready. |
| <a id="property-parententityid"></a> `parentEntityId` | `string` | Id of the parent entity (a uuid). |
| <a id="property-parententitytype"></a> `parentEntityType` | `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"` | Type of the parent entity access derives from. |
