# Type Alias: AddFavoriteRequest

> **AddFavoriteRequest** = \{ `entityId`: `string`; `entityType`: `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"`; \}

Request body for favoriting an entity.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-entityid"></a> `entityId` | `string` | The id of the entity to favorite. |
| <a id="property-entitytype"></a> `entityType` | `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"` | The type of the entity to favorite. |
