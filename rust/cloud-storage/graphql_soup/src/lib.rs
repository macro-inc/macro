//! GraphQL inbound adapter for Soup.
//!
//! This crate is intentionally additive: it maps GraphQL requests onto the
//! existing `soup` domain service without changing the existing REST API.
#![deny(missing_docs)]

use async_graphql::{
    Context, EmptyMutation, EmptySubscription, Enum, ID, Json, Object, Schema, SimpleObject, Union,
    dataloader::{DataLoader, Loader},
};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use filter_ast::Expr;
use item_filters::{
    CallFilters, CallStatus, ChannelFilters, ChannelThreadFilters, ChatFilters, CrmCompanyFilters,
    DocumentFilters, EmailFilters, EntityFilters, ForeignEntityFilters, NotificationFilters,
    ProjectFilters, PropertyFilter, SharedEmailFilter, TaskFilters,
    ast::{EntityFilterAst, crm_company::CrmCompanyLiteral},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_pagination::{
    Base64Str, CursorWithValAndFilter, PaginatedOpaqueCursor, SimpleSortMethod, TypeEraseCursor,
};
use models_properties::{EntityReference, service::property_value::PropertyValue};
use models_soup::{
    SoupProperty,
    call_record::SoupCallRecord,
    chat::SoupChat,
    comms::{ChannelType, SoupChannel, SoupChannelThread},
    crm_company::SoupCrmCompany,
    document::{SoupDocument, SoupDocumentSubType},
    email_thread::SoupEnrichedEmailThreadPreview,
    foreign_entity::SoupForeignEntity,
    item::SoupItem,
    project::SoupProject,
};
use notification::domain::models::{
    UserNotificationRow,
    request::{NotificationEntityRef, NotificationItemType},
};
use serde_json::Value;
use soup::domain::{
    models::{FrecencySoupItem, SoupQuery, SoupRequest, SoupType},
    ports::SoupService,
};
use std::{collections::HashMap, str::FromStr, sync::Arc};
use uuid::Uuid;

/// Request-scoped data required to execute a Soup GraphQL query.
///
/// The embedding Axum/service layer remains responsible for authentication and
/// for resolving inbox link IDs. This keeps `graphql_soup` independent from the
/// existing REST extractors.
#[derive(Clone)]
pub struct GraphqlSoupRequestContext {
    /// Authenticated Macro user executing the request.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// Link IDs available to the request.
    pub link_ids: Vec<Uuid>,
    /// Optional team access receipt used for CRM-scoped queries.
    pub team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
}

/// Key for loading properties attached to an entity.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EntityPropertiesKey {
    /// Entity type key used by the property service.
    pub entity_type: String,
    /// Entity ID used by the property service.
    pub entity_id: String,
}

/// Object-safe reader used by GraphQL property edges.
#[async_trait::async_trait]
pub trait SoupPropertyEdgeReader: Send + Sync + 'static {
    /// Load properties for the requested entity keys.
    async fn get_properties(
        &self,
        keys: Vec<EntityPropertiesKey>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<SoupProperty>>, rootcause::Report>;
}

#[async_trait::async_trait]
impl<T> SoupPropertyEdgeReader for T
where
    T: properties::PropertiesService,
{
    async fn get_properties(
        &self,
        keys: Vec<EntityPropertiesKey>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<SoupProperty>>, rootcause::Report> {
        let mut result = keys
            .iter()
            .cloned()
            .map(|key| (key, Vec::new()))
            .collect::<HashMap<_, _>>();

        let entity_refs = keys
            .iter()
            .filter_map(
                |key| match property_entity_type_from_key(&key.entity_type) {
                    Ok(Some(entity_type)) => {
                        Some(Ok(EntityReference::new(key.entity_id.clone(), entity_type)))
                    }
                    Ok(None) => None,
                    Err(err) => Some(Err(err)),
                },
            )
            .collect::<Result<Vec<_>, rootcause::Report>>()?;

        let properties_by_entity = self
            .get_entity_properties_batch(entity_refs)
            .await
            .map_err(|err| rootcause::report!(err))?;

        for (key, properties) in properties_by_entity {
            result.insert(
                EntityPropertiesKey {
                    entity_id: key.entity_id,
                    entity_type: key.entity_type.to_string(),
                },
                properties.into_iter().map(SoupProperty::from).collect(),
            );
        }

        Ok(result)
    }
}

/// DataLoader for entity property edges.
pub struct EntityPropertiesLoader {
    reader: Arc<dyn SoupPropertyEdgeReader>,
}

impl EntityPropertiesLoader {
    /// Create a new entity properties DataLoader.
    pub fn new(reader: Arc<dyn SoupPropertyEdgeReader>) -> Self {
        Self { reader }
    }
}

impl Loader<EntityPropertiesKey> for EntityPropertiesLoader {
    type Value = Vec<SoupProperty>;
    type Error = Arc<rootcause::Report>;

    async fn load(
        &self,
        keys: &[EntityPropertiesKey],
    ) -> Result<HashMap<EntityPropertiesKey, Self::Value>, Self::Error> {
        self.reader
            .get_properties(keys.to_vec())
            .await
            .map_err(Arc::new)
    }
}

/// Build a DataLoader for entity property edges.
pub fn entity_properties_loader(
    reader: Arc<dyn SoupPropertyEdgeReader>,
) -> DataLoader<EntityPropertiesLoader> {
    DataLoader::new(EntityPropertiesLoader::new(reader), tokio::spawn)
}

/// Key for loading notifications attached to an entity.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EntityNotificationsKey {
    /// Entity type key used by the notification service.
    pub entity_type: String,
    /// Entity ID used by the notification service.
    pub entity_id: String,
}

/// Object-safe reader used by GraphQL notification edges.
#[async_trait::async_trait]
pub trait SoupNotificationEdgeReader: Send + Sync + 'static {
    /// Load notifications for the requested entity keys.
    async fn get_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<EntityNotificationsKey>,
    ) -> Result<
        HashMap<EntityNotificationsKey, Vec<UserNotificationRow<serde_json::Value>>>,
        rootcause::Report,
    >;
}

#[async_trait::async_trait]
impl<T> SoupNotificationEdgeReader for T
where
    T: notification::domain::service::NotificationReader,
{
    async fn get_notifications(
        &self,
        user_id: MacroUserIdStr<'static>,
        keys: Vec<EntityNotificationsKey>,
    ) -> Result<
        HashMap<EntityNotificationsKey, Vec<UserNotificationRow<serde_json::Value>>>,
        rootcause::Report,
    > {
        let mut result = keys
            .iter()
            .cloned()
            .map(|key| (key, Vec::new()))
            .collect::<HashMap<_, _>>();

        let entity_refs = keys
            .iter()
            .map(|key| {
                Ok(NotificationEntityRef {
                    entity_type: notification_item_type_from_key(&key.entity_type)?,
                    id: key.entity_id.clone(),
                })
            })
            .collect::<Result<Vec<_>, rootcause::Report>>()?;

        let notifications_by_entity = self
            .get_entity_notifications_batch(user_id, entity_refs)
            .await
            .map_err(|err| rootcause::report!(err))?;

        for (key, notifications) in notifications_by_entity {
            result.insert(
                EntityNotificationsKey {
                    entity_type: notification_item_type_key(key.entity_type).to_owned(),
                    entity_id: key.id,
                },
                notifications,
            );
        }

        Ok(result)
    }
}

/// DataLoader for entity notification edges.
pub struct EntityNotificationsLoader {
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn SoupNotificationEdgeReader>,
}

impl EntityNotificationsLoader {
    /// Create a new entity notifications DataLoader.
    pub fn new(
        user_id: MacroUserIdStr<'static>,
        reader: Arc<dyn SoupNotificationEdgeReader>,
    ) -> Self {
        Self { user_id, reader }
    }
}

impl Loader<EntityNotificationsKey> for EntityNotificationsLoader {
    type Value = Vec<UserNotificationRow<serde_json::Value>>;
    type Error = Arc<rootcause::Report>;

    async fn load(
        &self,
        keys: &[EntityNotificationsKey],
    ) -> Result<HashMap<EntityNotificationsKey, Self::Value>, Self::Error> {
        self.reader
            .get_notifications(self.user_id.clone(), keys.to_vec())
            .await
            .map_err(Arc::new)
    }
}

/// Build a DataLoader for entity notification edges.
pub fn entity_notifications_loader(
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn SoupNotificationEdgeReader>,
) -> DataLoader<EntityNotificationsLoader> {
    DataLoader::new(
        EntityNotificationsLoader::new(user_id, reader),
        tokio::spawn,
    )
}

/// GraphQL Soup schema type.
pub type SoupSchema<S> = Schema<SoupQueryRoot<S>, EmptyMutation, EmptySubscription>;

/// GraphQL Soup schema type backed by a shared soup service.
pub type SharedSoupSchema<S> = SoupSchema<SharedSoupService<S>>;

/// GraphQL Soup schema type backed by the schema-only service.
pub type SchemaOnlySoupSchema = SoupSchema<SchemaOnlySoupService>;

/// Soup service used only to construct the GraphQL schema for SDL export.
#[derive(Clone, Copy, Debug, Default)]
pub struct SchemaOnlySoupService;

impl SoupService for SchemaOnlySoupService {
    async fn get_user_soup<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<soup::domain::ports::SoupOutput<T>, soup::domain::models::SoupErr>
    where
        SoupRequest<T>: soup::domain::models::IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        Err(soup::domain::models::SoupErr::CommsErr)
    }

    async fn get_user_soup_grouped(
        &self,
        _req: soup::domain::models::GroupedSortRequest<'_>,
    ) -> Result<Vec<soup::domain::models::GroupedSoupItem>, soup::domain::models::SoupErr> {
        Err(soup::domain::models::SoupErr::CommsErr)
    }
}

/// Object-safe-ish wrapper for sharing a concrete Soup service with GraphQL.
#[derive(Clone)]
pub struct SharedSoupService<S>(Arc<S>);

impl<S> SharedSoupService<S> {
    /// Create a shared Soup service wrapper.
    pub fn new(service: Arc<S>) -> Self {
        Self(service)
    }
}

impl<S> SoupService for SharedSoupService<S>
where
    S: SoupService,
{
    async fn get_user_soup<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<soup::domain::ports::SoupOutput<T>, soup::domain::models::SoupErr>
    where
        SoupRequest<T>: soup::domain::models::IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        self.0.get_user_soup(req, team_receipt).await
    }

    async fn get_user_soup_grouped(
        &self,
        req: soup::domain::models::GroupedSortRequest<'_>,
    ) -> Result<Vec<soup::domain::models::GroupedSoupItem>, soup::domain::models::SoupErr> {
        self.0.get_user_soup_grouped(req).await
    }
}

/// Root GraphQL query object for Soup.
pub struct SoupQueryRoot<S> {
    service: S,
}

impl<S> SoupQueryRoot<S> {
    /// Create a root GraphQL query object.
    pub fn new(service: S) -> Self {
        Self { service }
    }
}

/// Build a GraphQL schema for Soup suitable for SDL export or introspection.
pub fn build_schema() -> SchemaOnlySoupSchema {
    build_schema_with_service(SchemaOnlySoupService)
}

/// Build a GraphQL schema for Soup backed by the provided service.
pub fn build_schema_with_service<S>(service: S) -> SoupSchema<S>
where
    S: SoupService,
{
    Schema::build(
        SoupQueryRoot::new(service),
        EmptyMutation,
        EmptySubscription,
    )
    .finish()
}

/// Build a GraphQL schema for Soup backed by an `Arc`-shared service.
pub fn build_schema_from_arc<S>(service: Arc<S>) -> SharedSoupSchema<S>
where
    S: SoupService,
{
    build_schema_with_service(SharedSoupService::new(service))
}

#[Object]
impl<S> SoupQueryRoot<S>
where
    S: SoupService,
{
    /// Fetch a page of Soup items using the existing Soup filter AST format.
    async fn soup(&self, ctx: &Context<'_>, input: SoupInput) -> async_graphql::Result<SoupPage> {
        let request_context = ctx.data::<GraphqlSoupRequestContext>()?;
        let request = input.into_request(request_context)?;

        let effective_filter = request.cursor.filter();
        let team_receipt = resolve_crm_team_receipt(
            requests_crm_scope(effective_filter),
            request_context.team_receipt.clone(),
        )?;
        require_crm_admin_role(requests_crm_admin(effective_filter), &team_receipt)?;

        let page = self.service.get_user_soup(request, team_receipt).await?;
        Ok(SoupPage::from(page.type_erase()))
    }
}

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
    fn into_request(
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

/// Page returned by `Query.soup`.
#[derive(SimpleObject)]
pub struct SoupPage {
    /// Items in the current page.
    pub items: Vec<GraphqlSoupItem>,
    /// Opaque cursor for the next page, if one exists.
    pub next_cursor: Option<String>,
    /// Whether more items are available after this page.
    pub has_more: bool,
}

impl From<PaginatedOpaqueCursor<FrecencySoupItem>> for SoupPage {
    fn from(page: PaginatedOpaqueCursor<FrecencySoupItem>) -> Self {
        let has_more = page.next_cursor.is_some();
        Self {
            items: page.items.into_iter().map(GraphqlSoupItem::from).collect(),
            next_cursor: page.next_cursor,
            has_more,
        }
    }
}

/// GraphQL Soup item envelope.
pub struct GraphqlSoupItem {
    id: String,
    entity_type: String,
    frecency_score: f64,
    entity: GraphqlSoupEntity,
}

#[Object]
impl GraphqlSoupItem {
    async fn id(&self) -> &str {
        &self.id
    }

    async fn entity_type(&self) -> &str {
        &self.entity_type
    }

    async fn frecency_score(&self) -> f64 {
        self.frecency_score
    }

    async fn entity(&self) -> &GraphqlSoupEntity {
        &self.entity
    }
}

impl From<FrecencySoupItem> for GraphqlSoupItem {
    fn from(item: FrecencySoupItem) -> Self {
        let FrecencySoupItem {
            item,
            frecency_score,
            ..
        } = item;
        let entity_ref = item.entity();

        Self {
            id: entity_ref.entity_id.into_owned(),
            entity_type: entity_type_name(entity_ref.entity_type).to_owned(),
            frecency_score: frecency_score
                .map(|f| f.data.frecency_score)
                .unwrap_or_default(),
            entity: GraphqlSoupEntity::from(item),
        }
    }
}

/// GraphQL union over expanded Soup entity variants.
#[derive(Union)]
pub enum GraphqlSoupEntity {
    /// Document entity.
    Document(GraphqlSoupDocument),
    /// Chat entity.
    Chat(GraphqlSoupChat),
    /// Project entity.
    Project(GraphqlSoupProject),
    /// Email thread entity.
    EmailThread(GraphqlSoupEmailThread),
    /// Channel entity.
    Channel(GraphqlSoupChannel),
    /// Channel thread entity.
    ChannelThread(GraphqlSoupChannelThread),
    /// Call entity.
    Call(GraphqlSoupCall),
    /// CRM company entity.
    CrmCompany(GraphqlSoupCrmCompany),
    /// Foreign entity.
    ForeignEntity(GraphqlSoupForeignEntity),
}

impl From<SoupItem> for GraphqlSoupEntity {
    fn from(item: SoupItem) -> Self {
        match item {
            SoupItem::Document(item) => Self::Document(GraphqlSoupDocument(item)),
            SoupItem::Chat(item) => Self::Chat(GraphqlSoupChat(item)),
            SoupItem::Project(item) => Self::Project(GraphqlSoupProject(item)),
            SoupItem::EmailThread(item) => Self::EmailThread(GraphqlSoupEmailThread(item)),
            SoupItem::Channel(item) => Self::Channel(GraphqlSoupChannel(item)),
            SoupItem::ChannelThread(item) => Self::ChannelThread(GraphqlSoupChannelThread(item)),
            SoupItem::Call(item) => Self::Call(GraphqlSoupCall(item)),
            SoupItem::CrmCompany(item) => Self::CrmCompany(GraphqlSoupCrmCompany(item)),
            SoupItem::ForeignEntity(item) => Self::ForeignEntity(GraphqlSoupForeignEntity(item)),
        }
    }
}

/// GraphQL document entity.
pub struct GraphqlSoupDocument(SoupDocument);

#[Object]
impl GraphqlSoupDocument {
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    async fn name(&self) -> &str {
        &self.0.name
    }

    async fn owner_id(&self) -> String {
        self.0.owner_id.as_ref().to_owned()
    }

    async fn file_type(&self) -> Option<&str> {
        self.0.file_type.as_deref()
    }

    async fn project_id(&self) -> Option<ID> {
        self.0.project_id.map(|id| ID(id.to_string()))
    }

    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    async fn deleted_at(&self) -> Option<String> {
        self.0.deleted_at.map(|ts| ts.to_rfc3339())
    }

    async fn sub_type(&self) -> Option<GraphqlSoupDocumentSubType> {
        self.0
            .sub_type
            .as_ref()
            .map(GraphqlSoupDocumentSubType::from)
    }

    async fn properties(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupProperty>> {
        let loader = ctx.data::<DataLoader<EntityPropertiesLoader>>()?;
        let key = EntityPropertiesKey {
            entity_id: self.0.id.to_string(),
            entity_type: self.0.entity_type().to_string(),
        };

        let properties = loader
            .load_one(key)
            .await
            .map_err(|err| async_graphql::Error::new(err.to_string()))?
            .unwrap_or_default();
        Ok(properties.into_iter().map(GraphqlSoupProperty).collect())
    }

    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        load_entity_notifications(
            ctx,
            EntityNotificationsKey {
                entity_id: self.0.id.to_string(),
                entity_type: self.0.entity_type().to_string(),
            },
        )
        .await
    }
}

/// GraphQL document subtype details.
pub struct GraphqlSoupDocumentSubType {
    kind: &'static str,
    is_completed: Option<bool>,
}

impl From<&SoupDocumentSubType> for GraphqlSoupDocumentSubType {
    fn from(value: &SoupDocumentSubType) -> Self {
        match value {
            SoupDocumentSubType::Task { is_completed } => Self {
                kind: "task",
                is_completed: Some(*is_completed),
            },
            SoupDocumentSubType::Snippet {} => Self {
                kind: "snippet",
                is_completed: None,
            },
        }
    }
}

#[Object]
impl GraphqlSoupDocumentSubType {
    async fn kind(&self) -> &str {
        self.kind
    }

    async fn is_completed(&self) -> Option<bool> {
        self.is_completed
    }
}

/// GraphQL notification attached to a Soup entity.
pub struct GraphqlSoupNotification(UserNotificationRow<serde_json::Value>);

#[Object]
impl GraphqlSoupNotification {
    async fn id(&self) -> ID {
        ID(self.0.notification_id.to_string())
    }

    async fn event_type(&self) -> &str {
        &self.0.notification_event_type
    }

    async fn entity_type(&self) -> String {
        self.0.entity.entity_type.to_string()
    }

    async fn entity_id(&self) -> &str {
        &self.0.entity.entity_id
    }

    async fn sent(&self) -> bool {
        self.0.sent
    }

    async fn done(&self) -> bool {
        self.0.done
    }

    async fn seen(&self) -> bool {
        self.0.viewed_at.is_some()
    }

    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    async fn sender_id(&self) -> Option<String> {
        self.0.sender_id.as_ref().map(|sender| sender.to_string())
    }

    async fn metadata(&self) -> Json<Value> {
        Json(self.0.notification_metadata.clone())
    }
}

async fn load_entity_notifications(
    ctx: &Context<'_>,
    key: EntityNotificationsKey,
) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
    let loader = ctx.data::<DataLoader<EntityNotificationsLoader>>()?;
    let notifications = loader
        .load_one(key)
        .await
        .map_err(|err| async_graphql::Error::new(err.to_string()))?
        .unwrap_or_default();
    Ok(notifications
        .into_iter()
        .map(GraphqlSoupNotification)
        .collect())
}

/// GraphQL property attached to a Soup entity.
pub struct GraphqlSoupProperty(SoupProperty);

#[Object]
impl GraphqlSoupProperty {
    async fn id(&self) -> ID {
        ID(self.0.definition.id.to_string())
    }

    async fn display_name(&self) -> &str {
        &self.0.definition.display_name
    }

    async fn data_type(&self) -> String {
        format!("{:?}", self.0.definition.data_type)
    }

    async fn is_multi_select(&self) -> bool {
        self.0.definition.is_multi_select
    }

    async fn specific_entity_type(&self) -> Option<String> {
        self.0
            .definition
            .specific_entity_type
            .map(|entity_type| entity_type.to_string())
    }

    async fn is_system(&self) -> bool {
        self.0.definition.is_system
    }

    async fn is_metadata(&self) -> bool {
        self.0.definition.is_metadata
    }

    async fn value(&self) -> Option<GraphqlSoupPropertyValue> {
        self.0.value.as_ref().map(GraphqlSoupPropertyValue::from)
    }
}

/// GraphQL representation of a property value.
#[derive(SimpleObject)]
pub struct GraphqlSoupPropertyValue {
    kind: String,
    bool_value: Option<bool>,
    number_value: Option<f64>,
    string_value: Option<String>,
    date_value: Option<String>,
    select_option_ids: Vec<ID>,
    entity_references: Vec<GraphqlSoupPropertyEntityReference>,
    links: Vec<String>,
}

impl From<&PropertyValue> for GraphqlSoupPropertyValue {
    fn from(value: &PropertyValue) -> Self {
        match value {
            PropertyValue::Bool(value) => Self {
                kind: "Boolean".to_owned(),
                bool_value: Some(*value),
                number_value: None,
                string_value: None,
                date_value: None,
                select_option_ids: Vec::new(),
                entity_references: Vec::new(),
                links: Vec::new(),
            },
            PropertyValue::Num(value) => Self {
                kind: "Number".to_owned(),
                bool_value: None,
                number_value: Some(*value),
                string_value: None,
                date_value: None,
                select_option_ids: Vec::new(),
                entity_references: Vec::new(),
                links: Vec::new(),
            },
            PropertyValue::Str(value) => Self {
                kind: "String".to_owned(),
                bool_value: None,
                number_value: None,
                string_value: Some(value.clone()),
                date_value: None,
                select_option_ids: Vec::new(),
                entity_references: Vec::new(),
                links: Vec::new(),
            },
            PropertyValue::Date(value) => Self {
                kind: "Date".to_owned(),
                bool_value: None,
                number_value: None,
                string_value: None,
                date_value: Some(value.to_rfc3339()),
                select_option_ids: Vec::new(),
                entity_references: Vec::new(),
                links: Vec::new(),
            },
            PropertyValue::SelectOption(values) => Self {
                kind: "SelectOption".to_owned(),
                bool_value: None,
                number_value: None,
                string_value: None,
                date_value: None,
                select_option_ids: values.iter().map(|id| ID(id.to_string())).collect(),
                entity_references: Vec::new(),
                links: Vec::new(),
            },
            PropertyValue::EntityRef(values) => Self {
                kind: "EntityReference".to_owned(),
                bool_value: None,
                number_value: None,
                string_value: None,
                date_value: None,
                select_option_ids: Vec::new(),
                entity_references: values
                    .iter()
                    .map(GraphqlSoupPropertyEntityReference::from)
                    .collect(),
                links: Vec::new(),
            },
            PropertyValue::Link(values) => Self {
                kind: "Link".to_owned(),
                bool_value: None,
                number_value: None,
                string_value: None,
                date_value: None,
                select_option_ids: Vec::new(),
                entity_references: Vec::new(),
                links: values.clone(),
            },
        }
    }
}

/// GraphQL entity reference stored in a property value.
#[derive(SimpleObject)]
pub struct GraphqlSoupPropertyEntityReference {
    entity_id: String,
    entity_type: String,
    specific_message_id: Option<ID>,
}

impl From<&models_properties::EntityReference> for GraphqlSoupPropertyEntityReference {
    fn from(value: &models_properties::EntityReference) -> Self {
        Self {
            entity_id: value.entity_id.clone(),
            entity_type: value.entity_type.to_string(),
            specific_message_id: value
                .specific_message_id
                .map(|message_id| ID(message_id.to_string())),
        }
    }
}

/// GraphQL chat entity.
pub struct GraphqlSoupChat(SoupChat);

#[Object]
impl GraphqlSoupChat {
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    async fn name(&self) -> &str {
        &self.0.name
    }

    async fn owner_id(&self) -> String {
        self.0.owner_id.as_ref().to_owned()
    }

    async fn project_id(&self) -> Option<ID> {
        self.0.project_id.map(|id| ID(id.to_string()))
    }

    async fn is_persistent(&self) -> bool {
        self.0.is_persistent
    }

    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        load_entity_notifications(
            ctx,
            EntityNotificationsKey {
                entity_id: self.0.id.to_string(),
                entity_type: "chat".to_owned(),
            },
        )
        .await
    }
}

/// GraphQL project entity.
pub struct GraphqlSoupProject(SoupProject);

#[Object]
impl GraphqlSoupProject {
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    async fn name(&self) -> &str {
        &self.0.name
    }

    async fn owner_id(&self) -> String {
        self.0.owner_id.as_ref().to_owned()
    }

    async fn parent_id(&self) -> Option<ID> {
        self.0.parent_id.map(|id| ID(id.to_string()))
    }

    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        load_entity_notifications(
            ctx,
            EntityNotificationsKey {
                entity_id: self.0.id.to_string(),
                entity_type: "project".to_owned(),
            },
        )
        .await
    }
}

/// GraphQL email thread entity.
pub struct GraphqlSoupEmailThread(SoupEnrichedEmailThreadPreview);

#[Object]
impl GraphqlSoupEmailThread {
    async fn id(&self) -> ID {
        ID(self.0.thread.id.to_string())
    }

    async fn owner_id(&self) -> String {
        self.0.thread.owner_id.as_ref().to_owned()
    }

    async fn name(&self) -> Option<&str> {
        self.0.thread.name.as_deref()
    }

    async fn snippet(&self) -> Option<&str> {
        self.0.thread.snippet.as_deref()
    }

    async fn sender_email(&self) -> Option<&str> {
        self.0.thread.sender_email.as_deref()
    }

    async fn sender_name(&self) -> Option<&str> {
        self.0.thread.sender_name.as_deref()
    }

    async fn is_read(&self) -> bool {
        self.0.thread.is_read
    }

    async fn is_draft(&self) -> bool {
        self.0.thread.is_draft
    }

    async fn is_important(&self) -> bool {
        self.0.thread.is_important
    }

    async fn project_id(&self) -> Option<ID> {
        self.0.thread.project_id.as_ref().map(|id| ID(id.clone()))
    }

    async fn sort_ts(&self) -> String {
        self.0.thread.sort_ts.to_rfc3339()
    }

    async fn created_at(&self) -> String {
        self.0.thread.created_at.to_rfc3339()
    }

    async fn updated_at(&self) -> String {
        self.0.thread.updated_at.to_rfc3339()
    }

    async fn viewed_at(&self) -> Option<String> {
        self.0.thread.viewed_at.map(|ts| ts.to_rfc3339())
    }

    async fn attachment_count(&self) -> usize {
        self.0.attachments.len()
    }

    async fn participant_count(&self) -> usize {
        self.0.participants.len()
    }

    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        load_entity_notifications(
            ctx,
            EntityNotificationsKey {
                entity_id: self.0.thread.id.to_string(),
                entity_type: "email".to_owned(),
            },
        )
        .await
    }
}

/// GraphQL channel entity.
pub struct GraphqlSoupChannel(SoupChannel);

#[Object]
impl GraphqlSoupChannel {
    async fn id(&self) -> ID {
        ID(self.0.channel.channel.id.0.to_string())
    }

    async fn name(&self) -> Option<&str> {
        self.0.channel.channel.name.as_deref()
    }

    async fn channel_type(&self) -> &'static str {
        channel_type_name(self.0.channel.channel.channel_type)
    }

    async fn owner_id(&self) -> String {
        self.0.channel.channel.owner_id.as_ref().to_owned()
    }

    async fn team_id(&self) -> Option<ID> {
        self.0.channel.channel.team_id.map(|id| ID(id.to_string()))
    }

    async fn created_at(&self) -> String {
        self.0.channel.channel.created_at.to_rfc3339()
    }

    async fn updated_at(&self) -> String {
        self.0.channel.channel.updated_at.to_rfc3339()
    }

    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    async fn participant_count(&self) -> usize {
        self.0.channel.participants.len()
    }

    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        load_entity_notifications(
            ctx,
            EntityNotificationsKey {
                entity_id: self.0.channel.channel.id.0.to_string(),
                entity_type: "channel".to_owned(),
            },
        )
        .await
    }
}

/// GraphQL channel thread entity.
pub struct GraphqlSoupChannelThread(SoupChannelThread);

#[Object]
impl GraphqlSoupChannelThread {
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    async fn channel_id(&self) -> ID {
        ID(self.0.channel_id.to_string())
    }

    async fn sender_id(&self) -> &str {
        &self.0.sender_id
    }

    async fn content(&self) -> &str {
        &self.0.content
    }

    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    async fn effective_updated_at(&self) -> String {
        self.0.effective_updated_at().to_rfc3339()
    }

    async fn reply_count(&self) -> i64 {
        self.0.thread.reply_count
    }

    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        load_entity_notifications(
            ctx,
            EntityNotificationsKey {
                entity_id: self.0.id.to_string(),
                entity_type: "message".to_owned(),
            },
        )
        .await
    }
}

/// GraphQL call entity.
pub struct GraphqlSoupCall(SoupCallRecord);

#[Object]
impl GraphqlSoupCall {
    async fn id(&self) -> ID {
        ID(self.0.call_id.to_string())
    }

    async fn channel_id(&self) -> ID {
        ID(self.0.channel_id.to_string())
    }

    async fn created_by(&self) -> &str {
        &self.0.created_by
    }

    async fn name(&self) -> Option<&str> {
        self.0
            .custom_name
            .as_deref()
            .or(self.0.channel_name.as_deref())
    }

    async fn summary(&self) -> Option<&str> {
        self.0.summary.as_deref()
    }

    async fn started_at(&self) -> String {
        self.0.started_at.to_rfc3339()
    }

    async fn ended_at(&self) -> Option<String> {
        self.0.ended_at.map(|ts| ts.to_rfc3339())
    }

    async fn duration_ms(&self) -> Option<i64> {
        self.0.duration_ms
    }

    async fn is_active(&self) -> bool {
        self.0.is_active
    }

    async fn attended(&self) -> bool {
        self.0.attended
    }

    async fn participant_count(&self) -> usize {
        self.0.participants.len()
    }

    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        load_entity_notifications(
            ctx,
            EntityNotificationsKey {
                entity_id: self.0.call_id.to_string(),
                entity_type: "call".to_owned(),
            },
        )
        .await
    }
}

/// GraphQL CRM company entity.
pub struct GraphqlSoupCrmCompany(SoupCrmCompany);

#[Object]
impl GraphqlSoupCrmCompany {
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    async fn team_id(&self) -> ID {
        ID(self.0.team_id.to_string())
    }

    async fn name(&self) -> Option<&str> {
        self.0.name.as_deref()
    }

    async fn description(&self) -> Option<&str> {
        self.0.description.as_deref()
    }

    async fn email_sync(&self) -> bool {
        self.0.email_sync
    }

    async fn hidden(&self) -> bool {
        self.0.hidden
    }

    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    async fn domains(&self) -> Vec<String> {
        self.0
            .domains
            .iter()
            .map(|domain| domain.domain.clone())
            .collect()
    }

    async fn notifications(&self) -> Vec<GraphqlSoupNotification> {
        Vec::new()
    }
}

/// GraphQL foreign entity.
pub struct GraphqlSoupForeignEntity(SoupForeignEntity);

#[Object]
impl GraphqlSoupForeignEntity {
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    async fn foreign_entity_id(&self) -> &str {
        &self.0.foreign_entity_id
    }

    async fn foreign_entity_source(&self) -> &str {
        &self.0.foreign_entity_source
    }

    async fn stored_for_id(&self) -> &str {
        &self.0.stored_for_id
    }

    async fn stored_for_auth_entity(&self) -> &str {
        &self.0.stored_for_auth_entity
    }

    async fn metadata(&self) -> Json<Value> {
        Json(self.0.metadata.clone())
    }

    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    async fn notifications(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Vec<GraphqlSoupNotification>> {
        load_entity_notifications(
            ctx,
            EntityNotificationsKey {
                entity_id: self.0.foreign_entity_id.clone(),
                entity_type: "github".to_owned(),
            },
        )
        .await
    }
}

fn property_entity_type_from_key(
    key: &str,
) -> Result<Option<models_properties::EntityType>, rootcause::Report> {
    match key {
        "email" | "email_thread" => Ok(Some(models_properties::EntityType::Thread)),
        "crm_company" => Ok(Some(models_properties::EntityType::Company)),
        "call" | "channel_message" | "channel_thread" | "foreign_entity" | "github" => Ok(None),
        other => models_properties::EntityType::from_str(other)
            .map(Some)
            .map_err(|err| {
                rootcause::report!("invalid entity type {other} for property edge: {err}")
            }),
    }
}

fn notification_item_type_from_key(key: &str) -> Result<NotificationItemType, rootcause::Report> {
    match key {
        "email" | "email_thread" => Ok(NotificationItemType::Email),
        "message" | "channel_message" => Ok(NotificationItemType::Message),
        "channel" => Ok(NotificationItemType::Channel),
        "document" => Ok(NotificationItemType::Document),
        "project" => Ok(NotificationItemType::Project),
        "chat" => Ok(NotificationItemType::Chat),
        "call" => Ok(NotificationItemType::Call),
        "task" => Ok(NotificationItemType::Task),
        "github" | "foreign_entity" => Ok(NotificationItemType::Github),
        other => Err(rootcause::report!(
            "unsupported notification entity type {other}"
        )),
    }
}

fn notification_item_type_key(item_type: NotificationItemType) -> &'static str {
    match item_type {
        NotificationItemType::Email => "email",
        NotificationItemType::Message => "message",
        NotificationItemType::Channel => "channel",
        NotificationItemType::Document => "document",
        NotificationItemType::Project => "project",
        NotificationItemType::Chat => "chat",
        NotificationItemType::Call => "call",
        NotificationItemType::Task => "task",
        NotificationItemType::Github => "github",
    }
}

fn channel_type_name(channel_type: ChannelType) -> &'static str {
    match channel_type {
        ChannelType::Public => "public",
        ChannelType::Private => "private",
        ChannelType::DirectMessage => "direct_message",
        ChannelType::Team => "team",
    }
}

fn entity_type_name(entity_type: EntityType) -> &'static str {
    match entity_type {
        EntityType::Document => "document",
        EntityType::Chat => "chat",
        EntityType::Project => "project",
        EntityType::EmailThread => "email_thread",
        EntityType::Channel => "channel",
        EntityType::ChannelMessage => "channel_message",
        EntityType::Call => "call",
        EntityType::CrmCompany => "crm_company",
        EntityType::ForeignEntity => "foreign_entity",
        _ => "unknown",
    }
}

fn resolve_crm_team_receipt(
    crm_scope_requested: bool,
    receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
) -> async_graphql::Result<Option<EntityAccessReceipt<MemberTeamRole>>> {
    if crm_scope_requested && receipt.is_none() {
        return Err(async_graphql::Error::new(
            "CRM-scoped queries require team membership",
        ));
    }
    Ok(receipt)
}

fn require_crm_admin_role(
    admin_requested: bool,
    receipt: &Option<EntityAccessReceipt<MemberTeamRole>>,
) -> async_graphql::Result<()> {
    if !admin_requested {
        return Ok(());
    }
    let Some(receipt) = receipt else {
        return Err(async_graphql::Error::new(
            "Querying hidden CRM companies requires admin/owner team role",
        ));
    };
    if !receipt
        .entity_permission()
        .satisfies::<entity_access::domain::models::AdminTeamRole>()
    {
        return Err(async_graphql::Error::new(
            "Querying hidden CRM companies requires admin/owner team role",
        ));
    }
    Ok(())
}

fn requests_crm_scope(filter: &EntityFilterAst) -> bool {
    filter.email_filter.crm_scope.is_some()
}

fn requests_crm_admin(filter: &EntityFilterAst) -> bool {
    filter
        .crm_company_filter
        .as_deref()
        .is_some_and(ast_requests_crm_admin)
}

fn ast_requests_crm_admin(expr: &Expr<CrmCompanyLiteral>) -> bool {
    match expr {
        Expr::Literal(CrmCompanyLiteral::Hidden(_)) => true,
        Expr::And(a, b) | Expr::Or(a, b) => ast_requests_crm_admin(a) || ast_requests_crm_admin(b),
        Expr::Not(a) => ast_requests_crm_admin(a),
        _ => false,
    }
}
