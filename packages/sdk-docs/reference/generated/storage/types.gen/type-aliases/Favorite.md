# Type Alias: Favorite

> **Favorite** = \{ `channelId?`: `string` \| `null`; `channelType?`: `string` \| `null`; `createdAt`: `string`; `documentSubType?`: `string` \| `null`; `entityId`: `string`; `entityType`: `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"`; `fileType?`: `string` \| `null`; `sortOrder`: `number`; \}

A single favorited entity, including display metadata hydrated from the
favorited entity where available. Display names are deliberately not
included: clients resolve them from the entity previews pipeline, which
is viewer-relative for DM channels and updated by renames.

A favorite is identified by `(entity_type, entity_id)` within the user's
collection; there is no surrogate id.

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-channelid"></a> `channelId?` | `string` \| `null` | Owning channel id of the favorited channel message, when applicable. |
| <a id="property-channeltype"></a> `channelType?` | `string` \| `null` | Channel type (e.g. `public`, `direct_message`) of the favorited channel, when applicable. |
| <a id="property-createdat"></a> `createdAt` | `string` | When the favorite was created. |
| <a id="property-documentsubtype"></a> `documentSubType?` | `string` \| `null` | Document sub type (e.g. `task`) of the favorited document, when applicable. |
| <a id="property-entityid"></a> `entityId` | `string` | The id of the favorited entity. |
| <a id="property-entitytype"></a> `entityType` | `"user"` \| `"chat"` \| `"channel"` \| `"channel_message"` \| `"document"` \| `"project"` \| `"email_thread"` \| `"calendar_event"` \| `"team"` \| `"call"` \| `"foreign_entity"` \| `"static_file"` \| `"crm_company"` \| `"crm_contact"` \| `"crm_pipeline"` \| `"reminder"` \| `"skill"` \| `"agent_session"` \| `"scheduled_action"` \| `"initiative"` \| `"database"` \| `"database_row"` \| `"form"` | The type of the favorited entity. |
| <a id="property-filetype"></a> `fileType?` | `string` \| `null` | File type of the favorited document, when applicable. |
| <a id="property-sortorder"></a> `sortOrder` | `number` | Manual ordering value; lower sorts first. |
