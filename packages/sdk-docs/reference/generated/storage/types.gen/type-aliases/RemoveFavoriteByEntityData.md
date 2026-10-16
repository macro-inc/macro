# Type Alias: RemoveFavoriteByEntityData

> **RemoveFavoriteByEntityData** = \{ `body?`: `never`; `path`: \{ `entity_id`: `string`; `entity_type`: `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"`; \}; `query?`: `never`; `url`: `"/favorites/{entity_type}/{entity_id}"`; \}

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-body"></a> `body?` | `never` | - |
| <a id="property-path"></a> `path` | \{ `entity_id`: `string`; `entity_type`: `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"`; \} | - |
| `path.entity_id` | `string` | The id of the favorited entity. |
| `path.entity_type` | `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"` | The type of an entity in Macro |
| <a id="property-query"></a> `query?` | `never` | - |
| <a id="property-url"></a> `url` | `"/favorites/{entity_type}/{entity_id}"` | - |
