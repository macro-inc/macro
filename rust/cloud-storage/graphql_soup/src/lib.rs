//! GraphQL inbound adapter for Soup.
//!
//! This crate is intentionally additive: it maps GraphQL requests onto the
//! existing `soup` domain service without changing the existing REST API.

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
use models_properties::service::property_value::PropertyValue;
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
use serde_json::Value;
use soup::domain::{
    models::{FrecencySoupItem, SoupQuery, SoupRequest, SoupType},
    ports::SoupService,
};
use std::{collections::HashMap, sync::Arc};
use uuid::Uuid;

/// Request-scoped data required to execute a Soup GraphQL query.
///
/// The embedding Axum/service layer remains responsible for authentication and
/// for resolving inbox link IDs. This keeps `graphql_soup` independent from the
/// existing REST extractors.
#[derive(Clone)]
pub struct GraphqlSoupRequestContext {
    pub macro_user_id: MacroUserIdStr<'static>,
    pub link_ids: Vec<Uuid>,
    pub team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
}

/// Key for loading properties attached to an entity.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
pub struct EntityPropertiesKey {
    pub entity_type: String,
    pub entity_id: String,
}

/// Object-safe reader used by GraphQL property edges.
#[async_trait::async_trait]
pub trait SoupPropertyEdgeReader: Send + Sync + 'static {
    async fn get_properties(
        &self,
        keys: Vec<EntityPropertiesKey>,
    ) -> Result<HashMap<EntityPropertiesKey, Vec<SoupProperty>>, rootcause::Report>;
}

/// DataLoader for entity property edges.
pub struct EntityPropertiesLoader {
    reader: Arc<dyn SoupPropertyEdgeReader>,
}

impl EntityPropertiesLoader {
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

/// GraphQL Soup schema type.
pub type SoupSchema<S> = Schema<SoupQueryRoot<S>, EmptyMutation, EmptySubscription>;

/// GraphQL Soup schema type backed by a shared soup service.
pub type SharedSoupSchema<S> = SoupSchema<SharedSoupService<S>>;

/// Object-safe-ish wrapper for sharing a concrete Soup service with GraphQL.
#[derive(Clone)]
pub struct SharedSoupService<S>(Arc<S>);

impl<S> SharedSoupService<S> {
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
    ViewedAt,
    CreatedAt,
    UpdatedAt,
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
    pub items: Vec<GraphqlSoupItem>,
    pub next_cursor: Option<String>,
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

#[derive(Union)]
pub enum GraphqlSoupEntity {
    Document(GraphqlSoupDocument),
    Chat(GraphqlSoupChat),
    Project(GraphqlSoupProject),
    EmailThread(GraphqlSoupEmailThread),
    Channel(GraphqlSoupChannel),
    ChannelThread(GraphqlSoupChannelThread),
    Call(GraphqlSoupCall),
    CrmCompany(GraphqlSoupCrmCompany),
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
}

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
}

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
}

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
}

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
}

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
}

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
}

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
}

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
