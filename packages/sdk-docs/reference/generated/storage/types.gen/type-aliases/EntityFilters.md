# Type Alias: EntityFilters

> **EntityFilters** = \{ `agent_session_filters?`: [`AgentSessionFilters`](AgentSessionFilters.md); `calendar_event_filters?`: [`CalendarEventFilters`](CalendarEventFilters.md); `call_filters?`: [`CallFilters`](CallFilters.md); `channel_filters?`: [`ChannelFilters`](ChannelFilters.md); `channel_thread_filters?`: [`ChannelThreadFilters`](ChannelThreadFilters.md); `chat_filters?`: [`ChatFilters`](ChatFilters.md); `crm_company_filters?`: [`CrmCompanyFilters`](CrmCompanyFilters.md); `document_filters?`: [`DocumentFilters`](DocumentFilters.md); `email_filters?`: [`EmailFilters`](EmailFilters.md); `favorites_only?`: `boolean` \| `null`; `foreign_entity_filters?`: [`ForeignEntityFilters`](ForeignEntityFilters.md); `initiative_filters?`: [`InitiativeFilters`](InitiativeFilters.md); `project_filters?`: [`ProjectFilters`](ProjectFilters.md); `property_filters?`: [`PropertyFilter`](PropertyFilter.md)[]; `tag_filter_mode?`: [`TagFilterMode`](TagFilterMode.md); `tag_option_ids?`: `string`[]; \}

a bundle of all of the filters for each entity type

## Properties

| Property | Type | Description |
| ------ | ------ | ------ |
| <a id="property-agent_session_filters"></a> `agent_session_filters?` | [`AgentSessionFilters`](AgentSessionFilters.md) | the bundled [AgentSessionFilters] |
| <a id="property-calendar_event_filters"></a> `calendar_event_filters?` | [`CalendarEventFilters`](CalendarEventFilters.md) | the bundled [CalendarEventFilters] |
| <a id="property-call_filters"></a> `call_filters?` | [`CallFilters`](CallFilters.md) | the bundled [CallFilters] |
| <a id="property-channel_filters"></a> `channel_filters?` | [`ChannelFilters`](ChannelFilters.md) | the bundled [ChannelFilters] |
| <a id="property-channel_thread_filters"></a> `channel_thread_filters?` | [`ChannelThreadFilters`](ChannelThreadFilters.md) | the bundled [ChannelThreadFilters] |
| <a id="property-chat_filters"></a> `chat_filters?` | [`ChatFilters`](ChatFilters.md) | the bundled [ChatFilters] |
| <a id="property-crm_company_filters"></a> `crm_company_filters?` | [`CrmCompanyFilters`](CrmCompanyFilters.md) | the bundled [CrmCompanyFilters] |
| <a id="property-document_filters"></a> `document_filters?` | [`DocumentFilters`](DocumentFilters.md) | the bundled [DocumentFilters] |
| <a id="property-email_filters"></a> `email_filters?` | [`EmailFilters`](EmailFilters.md) | the bundled [EmailFilters] |
| <a id="property-favorites_only"></a> `favorites_only?` | `boolean` \| `null` | Restrict results to the authenticated viewer's favorites when true. |
| <a id="property-foreign_entity_filters"></a> `foreign_entity_filters?` | [`ForeignEntityFilters`](ForeignEntityFilters.md) | the bundled [ForeignEntityFilters] |
| <a id="property-initiative_filters"></a> `initiative_filters?` | [`InitiativeFilters`](InitiativeFilters.md) | Initiative filters. Initiatives are opt-in. |
| <a id="property-project_filters"></a> `project_filters?` | [`ProjectFilters`](ProjectFilters.md) | the bundled [ProjectFilters] |
| <a id="property-property_filters"></a> `property_filters?` | [`PropertyFilter`](PropertyFilter.md)[] | property-based filters applied across entity types |
| <a id="property-tag_filter_mode"></a> `tag_filter_mode?` | [`TagFilterMode`](TagFilterMode.md) | How the `tag_option_ids` combine: `any` (default) matches entities holding at least one selected tag, `all` requires every selected tag. |
| <a id="property-tag_option_ids"></a> `tag_option_ids?` | `string`[] | tag option ids matched against `properties.values`, OR'd together across all tag definitions. Option ids are globally unique, so the match ignores the owning definition id (personal and team tags combine into one OR). |
