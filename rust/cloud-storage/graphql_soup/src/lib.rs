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
use item_filters::ast::{EntityFilterAst, crm_company::CrmCompanyLiteral};
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

/// Build a GraphQL schema for Soup backed by the provided service.
pub fn build_schema<S>(service: S) -> SoupSchema<S>
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
    build_schema(SharedSoupService::new(service))
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
    pub limit: Option<u16>,
    /// Whether to return expanded Soup items. Defaults to true.
    pub expand: Option<bool>,
    /// Simple timestamp sort. Defaults to VIEWED_AT. Frecency is intentionally
    /// not supported by this initial GraphQL adapter.
    pub sort_method: Option<GraphqlSimpleSortMethod>,
    /// Opaque cursor returned by a previous GraphQL Soup response.
    pub cursor: Option<String>,
    /// Existing Soup AST filter payload, represented as GraphQL JSON.
    pub filters: Option<Json<EntityFilterAst>>,
}

impl SoupInput {
    fn into_request(
        self,
        request_context: &GraphqlSoupRequestContext,
    ) -> async_graphql::Result<SoupRequest<EntityFilterAst>> {
        let filter = self.filters.map(|Json(filter)| filter).unwrap_or_default();
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
