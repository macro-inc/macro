use async_graphql::{Enum, ID};
use item_filters::{
    CallFilters, CallStatus, ChannelFilters, ChannelThreadFilters, ChatFilters, CrmCompanyFilters,
    DocumentFilters, EmailFilters, EntityFilters, ForeignEntityFilters, NotificationFilters,
    ProjectFilters, PropertyFilter, SharedEmailFilter, TaskFilters, ast::EntityFilterAst,
};
use models_pagination::{Base64Str, CursorWithValAndFilter, SimpleSortMethod};
use soup::domain::models::{SoupQuery, SoupRequest, SoupType};
use uuid::Uuid;

use crate::request_context::GraphqlSoupRequestContext;

/// Input for `Query.soup`.
#[derive(async_graphql::InputObject)]
pub struct SoupInput {
    /// Maximum number of items to return. Defaults to 20, max 500.
    limit: Option<u16>,
    /// Whether to return expanded Soup items. Defaults to true.
    expand: Option<bool>,
    /// Simple timestamp sort. Defaults to VIEWED_AT. Frecency is intentionally
    /// not supported by this initial GraphQL adapter.
    sort_method: Option<GraphqlSimpleSortMethod>,
    /// Opaque cursor returned by a previous GraphQL Soup response.
    cursor: Option<String>,
    /// Typed filters applied to each Soup entity type.
    filters: Option<GraphqlEntityFilters>,
}

impl SoupInput {
    pub(crate) fn into_request(
        self,
        request_context: &GraphqlSoupRequestContext,
    ) -> async_graphql::Result<SoupRequest<EntityFilterAst>> {
        let filter = self
            .filters
            .map(GraphqlEntityFilters::into_ast)
            .transpose()?
            .unwrap_or_default();
        let sort = self
            .sort_method
            .map(SimpleSortMethod::from)
            .unwrap_or(SimpleSortMethod::ViewedAt);

        let cursor = match self.cursor {
            Some(cursor) => {
                let cursor = Base64Str::<
                    CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>,
                >::new_from_string(cursor)
                .decode_json()
                .map_err(|err| async_graphql::Error::new(format!("invalid cursor: {err}")))?;
                SoupQuery::new_cursor_simple(cursor)
            }
            None => SoupQuery::new_sort_simple(sort, filter),
        };

        Ok(SoupRequest {
            soup_type: match self.expand {
                Some(false) => SoupType::UnExpanded,
                Some(true) | None => SoupType::Expanded,
            },
            limit: self.limit.unwrap_or(20).min(500),
            cursor,
            user: request_context.macro_user_id.clone(),
            email_preview_view: Default::default(),
            link_ids: request_context.link_ids.clone(),
        })
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlEntityFilters {
    project_filters: Option<GraphqlProjectFilters>,
    document_filters: Option<GraphqlDocumentFilters>,
    chat_filters: Option<GraphqlChatFilters>,
    channel_filters: Option<GraphqlChannelFilters>,
    channel_thread_filters: Option<GraphqlChannelThreadFilters>,
    call_filters: Option<GraphqlCallFilters>,
    email_filters: Option<GraphqlEmailFilters>,
    crm_company_filters: Option<GraphqlCrmCompanyFilters>,
    foreign_entity_filters: Option<GraphqlForeignEntityFilters>,
    #[graphql(default)]
    property_filters: Vec<GraphqlPropertyFilter>,
}

impl GraphqlEntityFilters {
    fn into_ast(self) -> async_graphql::Result<EntityFilterAst> {
        EntityFilterAst::new_from_filters(self.into())
            .map(|filter| filter.unwrap_or_default())
            .map_err(|err| async_graphql::Error::new(format!("invalid filters: {err}")))
    }
}

impl From<GraphqlEntityFilters> for EntityFilters {
    fn from(value: GraphqlEntityFilters) -> Self {
        Self {
            project_filters: optional_input(value.project_filters),
            document_filters: optional_input(value.document_filters),
            chat_filters: optional_input(value.chat_filters),
            channel_filters: optional_input(value.channel_filters),
            channel_thread_filters: optional_input(value.channel_thread_filters),
            call_filters: optional_input(value.call_filters),
            email_filters: optional_input(value.email_filters),
            crm_company_filters: optional_input(value.crm_company_filters),
            foreign_entity_filters: optional_input(value.foreign_entity_filters),
            property_filters: value.property_filters.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlNotificationFilters {
    done: Option<bool>,
    seen: Option<bool>,
}

impl From<GraphqlNotificationFilters> for NotificationFilters {
    fn from(value: GraphqlNotificationFilters) -> Self {
        Self {
            done: value.done,
            seen: value.seen,
        }
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlTaskFilters {
    include_cbm_atm_nc: Option<bool>,
}

impl From<GraphqlTaskFilters> for TaskFilters {
    fn from(value: GraphqlTaskFilters) -> Self {
        Self {
            include_cbm_atm_nc: value.include_cbm_atm_nc,
        }
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlDocumentFilters {
    #[graphql(default)]
    file_types: Vec<String>,
    #[graphql(default)]
    document_ids: Vec<ID>,
    #[graphql(default)]
    project_ids: Vec<ID>,
    #[graphql(default)]
    owners: Vec<String>,
    importance: Option<bool>,
    notification_filters: Option<GraphqlNotificationFilters>,
    task_filters: Option<GraphqlTaskFilters>,
    #[graphql(default)]
    sub_types: Vec<GraphqlDocumentSubTypeFilter>,
    is_email_attachment: Option<bool>,
}

impl From<GraphqlDocumentFilters> for DocumentFilters {
    fn from(value: GraphqlDocumentFilters) -> Self {
        Self {
            file_types: value.file_types,
            document_ids: ids_to_strings(value.document_ids),
            project_ids: ids_to_strings(value.project_ids),
            owners: value.owners,
            importance: value.importance,
            notification_filters: optional_input(value.notification_filters),
            task_filters: optional_input(value.task_filters),
            sub_types: value
                .sub_types
                .into_iter()
                .map(GraphqlDocumentSubTypeFilter::as_filter_value)
                .collect(),
            is_email_attachment: value.is_email_attachment,
        }
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlDocumentSubTypeFilter {
    Task,
    Snippet,
}

impl GraphqlDocumentSubTypeFilter {
    fn as_filter_value(self) -> String {
        match self {
            Self::Task => "task",
            Self::Snippet => "snippet",
        }
        .to_owned()
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlChatFilters {
    #[graphql(default)]
    role: Vec<GraphqlChatRoleFilter>,
    #[graphql(default)]
    chat_ids: Vec<ID>,
    #[graphql(default)]
    project_ids: Vec<ID>,
    #[graphql(default)]
    owners: Vec<String>,
    importance: Option<bool>,
    notification_filters: Option<GraphqlNotificationFilters>,
}

impl From<GraphqlChatFilters> for ChatFilters {
    fn from(value: GraphqlChatFilters) -> Self {
        Self {
            role: value
                .role
                .into_iter()
                .map(GraphqlChatRoleFilter::as_filter_value)
                .collect(),
            chat_ids: ids_to_strings(value.chat_ids),
            project_ids: ids_to_strings(value.project_ids),
            owners: value.owners,
            importance: value.importance,
            notification_filters: optional_input(value.notification_filters),
        }
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlChatRoleFilter {
    User,
    System,
    Assistant,
}

impl GraphqlChatRoleFilter {
    fn as_filter_value(self) -> String {
        match self {
            Self::User => "user",
            Self::System => "system",
            Self::Assistant => "assistant",
        }
        .to_owned()
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlChannelFilters {
    #[graphql(default)]
    thread_ids: Vec<ID>,
    #[graphql(default)]
    mentions: Vec<String>,
    org_id: Option<i64>,
    team_id: Option<ID>,
    #[graphql(default)]
    channel_ids: Vec<ID>,
    #[graphql(default)]
    sender_ids: Vec<String>,
    #[graphql(default)]
    channel_types: Vec<GraphqlChannelTypeFilter>,
    importance: Option<bool>,
    notification_filters: Option<GraphqlNotificationFilters>,
}

impl From<GraphqlChannelFilters> for ChannelFilters {
    fn from(value: GraphqlChannelFilters) -> Self {
        Self {
            thread_ids: ids_to_strings(value.thread_ids),
            mentions: value.mentions,
            org_id: value.org_id,
            team_id: value.team_id.map(|id| id.to_string()),
            channel_ids: ids_to_strings(value.channel_ids),
            sender_ids: value.sender_ids,
            channel_types: value
                .channel_types
                .into_iter()
                .map(GraphqlChannelTypeFilter::as_filter_value)
                .collect(),
            importance: value.importance,
            notification_filters: optional_input(value.notification_filters),
        }
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlChannelTypeFilter {
    Public,
    Private,
    DirectMessage,
    Team,
}

impl GraphqlChannelTypeFilter {
    fn as_filter_value(self) -> String {
        match self {
            Self::Public => "public",
            Self::Private => "private",
            Self::DirectMessage => "direct_message",
            Self::Team => "team",
        }
        .to_owned()
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlChannelThreadFilters {
    #[graphql(default)]
    thread_ids: Vec<ID>,
    #[graphql(default)]
    channel_ids: Vec<ID>,
    #[graphql(default)]
    root_sender_ids: Vec<String>,
}

impl From<GraphqlChannelThreadFilters> for ChannelThreadFilters {
    fn from(value: GraphqlChannelThreadFilters) -> Self {
        Self {
            thread_ids: ids_to_strings(value.thread_ids),
            channel_ids: ids_to_strings(value.channel_ids),
            root_sender_ids: value.root_sender_ids,
        }
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlCallFilters {
    #[graphql(default)]
    call_ids: Vec<ID>,
    #[graphql(default)]
    channel_ids: Vec<ID>,
    #[graphql(default)]
    speaker_ids: Vec<String>,
    status: Option<GraphqlCallStatus>,
    attended: Option<bool>,
}

impl From<GraphqlCallFilters> for CallFilters {
    fn from(value: GraphqlCallFilters) -> Self {
        Self {
            call_ids: ids_to_strings(value.call_ids),
            channel_ids: ids_to_strings(value.channel_ids),
            speaker_ids: value.speaker_ids,
            status: value.status.map(Into::into),
            attended: value.attended,
        }
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlCallStatus {
    Attended,
    Missed,
    Unattended,
}

impl From<GraphqlCallStatus> for CallStatus {
    fn from(value: GraphqlCallStatus) -> Self {
        match value {
            GraphqlCallStatus::Attended => Self::Attended,
            GraphqlCallStatus::Missed => Self::Missed,
            GraphqlCallStatus::Unattended => Self::Unattended,
        }
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlEmailFilters {
    #[graphql(default)]
    senders: Vec<String>,
    #[graphql(default)]
    cc: Vec<String>,
    #[graphql(default)]
    bcc: Vec<String>,
    #[graphql(default)]
    recipients: Vec<String>,
    #[graphql(default)]
    email_thread_ids: Vec<ID>,
    #[graphql(default)]
    link_ids: Vec<ID>,
    #[graphql(default)]
    project_ids: Vec<String>,
    importance: Option<bool>,
    notification_filters: Option<GraphqlNotificationFilters>,
    #[graphql(default)]
    include_labels: Vec<String>,
    #[graphql(default)]
    exclude_labels: Vec<String>,
    shared: Option<GraphqlSharedEmailFilter>,
    #[graphql(default)]
    crm_domains: Vec<String>,
    #[graphql(default)]
    crm_addresses: Vec<String>,
    calendar_only: Option<bool>,
}

impl From<GraphqlEmailFilters> for EmailFilters {
    fn from(value: GraphqlEmailFilters) -> Self {
        Self {
            senders: value.senders,
            cc: value.cc,
            bcc: value.bcc,
            recipients: value.recipients,
            email_thread_ids: ids_to_strings(value.email_thread_ids),
            link_ids: ids_to_strings(value.link_ids),
            project_ids: value.project_ids,
            importance: value.importance,
            notification_filters: optional_input(value.notification_filters),
            include_labels: value.include_labels,
            exclude_labels: value.exclude_labels,
            shared: value.shared.map(Into::into).unwrap_or_default(),
            crm_domains: value.crm_domains,
            crm_addresses: value.crm_addresses,
            calendar_only: value.calendar_only,
        }
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlSharedEmailFilter {
    Exclude,
    Include,
    Only,
}

impl From<GraphqlSharedEmailFilter> for SharedEmailFilter {
    fn from(value: GraphqlSharedEmailFilter) -> Self {
        match value {
            GraphqlSharedEmailFilter::Exclude => Self::Exclude,
            GraphqlSharedEmailFilter::Include => Self::Include,
            GraphqlSharedEmailFilter::Only => Self::Only,
        }
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlCrmCompanyFilters {
    #[graphql(default)]
    company_ids: Vec<ID>,
    hidden: Option<bool>,
}

impl From<GraphqlCrmCompanyFilters> for CrmCompanyFilters {
    fn from(value: GraphqlCrmCompanyFilters) -> Self {
        Self {
            company_ids: ids_to_strings(value.company_ids),
            hidden: value.hidden,
        }
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlForeignEntityFilters {
    #[graphql(default)]
    ids: Vec<ID>,
    #[graphql(default)]
    foreign_entity_ids: Vec<String>,
    #[graphql(default)]
    foreign_entity_sources: Vec<String>,
    includes_me: Option<bool>,
    notification_filters: Option<GraphqlNotificationFilters>,
}

impl From<GraphqlForeignEntityFilters> for ForeignEntityFilters {
    fn from(value: GraphqlForeignEntityFilters) -> Self {
        Self {
            ids: ids_to_strings(value.ids),
            foreign_entity_ids: value.foreign_entity_ids,
            foreign_entity_sources: value.foreign_entity_sources,
            includes_me: value.includes_me.unwrap_or_default(),
            notification_filters: optional_input(value.notification_filters),
        }
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlProjectFilters {
    #[graphql(default)]
    project_ids: Vec<ID>,
    include_root: Option<bool>,
    #[graphql(default)]
    owners: Vec<String>,
    importance: Option<bool>,
    notification_filters: Option<GraphqlNotificationFilters>,
}

impl From<GraphqlProjectFilters> for ProjectFilters {
    fn from(value: GraphqlProjectFilters) -> Self {
        Self {
            project_ids: ids_to_strings(value.project_ids),
            include_root: value.include_root.unwrap_or_default(),
            owners: value.owners,
            importance: value.importance,
            notification_filters: optional_input(value.notification_filters),
        }
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlPropertyFilter {
    property_definition_id: ID,
    entity_type: Option<GraphqlPropertyEntityType>,
    #[graphql(default)]
    option_ids: Vec<ID>,
    #[graphql(default)]
    entity_ids: Vec<String>,
}

impl From<GraphqlPropertyFilter> for PropertyFilter {
    fn from(value: GraphqlPropertyFilter) -> Self {
        Self {
            property_definition_id: value.property_definition_id.to_string(),
            entity_type: value
                .entity_type
                .map(GraphqlPropertyEntityType::as_filter_value),
            option_ids: ids_to_strings(value.option_ids),
            entity_ids: value.entity_ids,
        }
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlPropertyEntityType {
    Channel,
    Chat,
    Company,
    Document,
    Project,
    Task,
    Thread,
    User,
}

impl GraphqlPropertyEntityType {
    fn as_filter_value(self) -> String {
        match self {
            Self::Channel => "CHANNEL",
            Self::Chat => "CHAT",
            Self::Company => "COMPANY",
            Self::Document => "DOCUMENT",
            Self::Project => "PROJECT",
            Self::Task => "TASK",
            Self::Thread => "THREAD",
            Self::User => "USER",
        }
        .to_owned()
    }
}

fn optional_input<T, U>(value: Option<T>) -> U
where
    T: Into<U>,
    U: Default,
{
    value.map(Into::into).unwrap_or_default()
}

fn ids_to_strings(ids: Vec<ID>) -> Vec<String> {
    ids.into_iter().map(|id| id.to_string()).collect()
}

/// GraphQL representation of supported simple Soup sorts.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlSimpleSortMethod {
    /// Sort by most recently viewed.
    ViewedAt,
    /// Sort by creation timestamp.
    CreatedAt,
    /// Sort by update timestamp.
    UpdatedAt,
    /// Sort by viewed timestamp, falling back to updated timestamp.
    ViewedUpdated,
}

impl From<GraphqlSimpleSortMethod> for SimpleSortMethod {
    fn from(value: GraphqlSimpleSortMethod) -> Self {
        match value {
            GraphqlSimpleSortMethod::ViewedAt => SimpleSortMethod::ViewedAt,
            GraphqlSimpleSortMethod::CreatedAt => SimpleSortMethod::CreatedAt,
            GraphqlSimpleSortMethod::UpdatedAt => SimpleSortMethod::UpdatedAt,
            GraphqlSimpleSortMethod::ViewedUpdated => SimpleSortMethod::ViewedUpdated,
        }
    }
}
