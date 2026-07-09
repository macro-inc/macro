use async_graphql::{Context, Enum, ID, Json, Object, SimpleObject, Union, dataloader::DataLoader};
use model_entity::EntityType;
use models_pagination::PaginatedOpaqueCursor;
use models_properties::service::property_value::PropertyValue;
use models_soup::{
    SoupProperty,
    call_record::{SoupCallRecord, SoupCallRecordParticipant},
    chat::SoupChat,
    comms::{ChannelMessage, ChannelParticipant, ChannelType, SoupChannel, SoupChannelThread},
    crm_company::SoupCrmCompany,
    document::{SoupDocument, SoupDocumentSubType},
    email_thread::{
        SoupAttachment, SoupContact, SoupEnrichedEmailThreadPreview, SoupLabel,
        SoupLabelListVisibility, SoupLabelType, SoupMessageListVisibility,
    },
    foreign_entity::SoupForeignEntity,
    item::SoupItem,
    project::SoupProject,
};
use notification::domain::models::UserNotificationRow;
use serde_json::Value;
use soup::domain::models::FrecencySoupItem;

use crate::loaders::{EntityNotificationsKey, EntityNotificationsLoader};

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
    entity_type: GraphqlSoupEntityType,
    frecency_score: f64,
    entity: GraphqlSoupEntity,
}

/// GraphQL representation of Soup entity types.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlSoupEntityType {
    /// Document entity.
    Document,
    /// Chat entity.
    Chat,
    /// Project entity.
    Project,
    /// Email thread entity.
    EmailThread,
    /// Channel entity.
    Channel,
    /// Channel thread entity.
    ChannelThread,
    /// Call entity.
    Call,
    /// CRM company entity.
    CrmCompany,
    /// Foreign entity.
    ForeignEntity,
    /// User entity
    User,
    /// Team entity
    Team,
    /// Static File
    StaticFile,
    /// crm contact
    CrmContact,
}

impl From<EntityType> for GraphqlSoupEntityType {
    fn from(entity_type: EntityType) -> Self {
        match entity_type {
            EntityType::Document => Self::Document,
            EntityType::Chat => Self::Chat,
            EntityType::Project => Self::Project,
            EntityType::EmailThread => Self::EmailThread,
            EntityType::Channel => Self::Channel,
            EntityType::ChannelMessage => Self::ChannelThread,
            EntityType::Call => Self::Call,
            EntityType::CrmCompany => Self::CrmCompany,
            EntityType::ForeignEntity => Self::ForeignEntity,
            EntityType::User => Self::User,
            EntityType::Team => Self::Team,
            EntityType::StaticFile => Self::StaticFile,
            EntityType::CrmContact => Self::CrmContact,
        }
    }
}

#[Object]
impl GraphqlSoupItem {
    async fn id(&self) -> ID {
        ID(self.id.clone())
    }

    async fn entity_type(&self) -> GraphqlSoupEntityType {
        self.entity_type
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
            entity_type: GraphqlSoupEntityType::from(entity_ref.entity_type),
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

    async fn properties(&self) -> Vec<GraphqlSoupProperty> {
        self.0
            .properties
            .iter()
            .cloned()
            .map(GraphqlSoupProperty)
            .collect()
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

    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::from(self.0.entity.entity_type)
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

#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlSoupDataType {
    /// Boolean true/false values.
    Boolean,
    /// Date and time values.
    Date,
    /// Numeric values.
    Number,
    /// String/text values.
    String,
    /// Select property with numeric options.
    SelectNumber,
    /// Select property with string options.
    SelectString,
    /// Tag property - user- or team-scoped colored labels (always multi-select).
    Tag,
    /// Entity reference property.
    Entity,
    /// Link value Property.
    Link,
}

impl GraphqlSoupDataType {
    fn from_properties_data_type(dt: models_properties::DataType) -> Self {
        match dt {
            models_properties::DataType::Boolean => Self::Boolean,
            models_properties::DataType::Date => Self::Date,
            models_properties::DataType::Number => Self::Number,
            models_properties::DataType::String => Self::String,
            models_properties::DataType::SelectNumber => Self::SelectNumber,
            models_properties::DataType::SelectString => Self::SelectString,
            models_properties::DataType::Tag => Self::Tag,
            models_properties::DataType::Entity => Self::Entity,
            models_properties::DataType::Link => Self::Link,
        }
    }
}

/// GraphQL property attached to a Soup entity.
pub struct GraphqlSoupProperty(SoupProperty);

#[Object]
impl GraphqlSoupProperty {
    /// Id of the shared property *definition* — deliberately not named `id`:
    /// a property instance has no global identity (its `value` is
    /// per-entity), so it must never be treated as a cacheable entity.
    /// Normalized caches key objects by the presence of an `id` field.
    async fn property_definition_id(&self) -> ID {
        ID(self.0.definition.id.to_string())
    }

    async fn display_name(&self) -> &str {
        &self.0.definition.display_name
    }

    async fn data_type(&self) -> GraphqlSoupDataType {
        GraphqlSoupDataType::from_properties_data_type(self.0.definition.data_type)
    }

    async fn is_multi_select(&self) -> bool {
        self.0.definition.is_multi_select
    }

    async fn specific_entity_type(&self) -> Option<GraphqlSoupPropertyEntityType> {
        self.0
            .definition
            .specific_entity_type
            .map(GraphqlSoupPropertyEntityType::from_property_entity)
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
    entity_type: GraphqlSoupPropertyEntityType,
    specific_message_id: Option<ID>,
}

#[derive(Enum, Clone, Copy, PartialEq, Eq)]
pub enum GraphqlSoupPropertyEntityType {
    Channel,
    Chat,
    Company,
    Document,
    Project,
    Task,
    Thread,
    User,
}

impl GraphqlSoupPropertyEntityType {
    fn from_property_entity(entity: models_properties::EntityType) -> Self {
        match entity {
            models_properties::EntityType::Channel => Self::Channel,
            models_properties::EntityType::Chat => Self::Chat,
            models_properties::EntityType::Company => Self::Company,
            models_properties::EntityType::Document => Self::Document,
            models_properties::EntityType::Project => Self::Project,
            models_properties::EntityType::Task => Self::Task,
            models_properties::EntityType::Thread => Self::Thread,
            models_properties::EntityType::User => Self::User,
        }
    }
}

impl From<&models_properties::EntityReference> for GraphqlSoupPropertyEntityReference {
    fn from(value: &models_properties::EntityReference) -> Self {
        Self {
            entity_id: value.entity_id.clone(),
            entity_type: GraphqlSoupPropertyEntityType::from_property_entity(value.entity_type),
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

    async fn deleted_at(&self) -> Option<String> {
        self.0.deleted_at.map(|ts| ts.to_rfc3339())
    }

    async fn properties(&self) -> Vec<GraphqlSoupProperty> {
        self.0
            .properties
            .iter()
            .cloned()
            .map(GraphqlSoupProperty)
            .collect()
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

    async fn deleted_at(&self) -> Option<String> {
        self.0.deleted_at.map(|ts| ts.to_rfc3339())
    }

    async fn properties(&self) -> Vec<GraphqlSoupProperty> {
        self.0
            .properties
            .iter()
            .cloned()
            .map(GraphqlSoupProperty)
            .collect()
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

/// GraphQL email participant/contact.
pub struct GraphqlSoupEmailParticipant {
    id: ID,
    link_id: ID,
    name: Option<String>,
    email: Option<String>,
    sfs_photo_url: Option<String>,
}

impl From<&SoupContact> for GraphqlSoupEmailParticipant {
    fn from(value: &SoupContact) -> Self {
        Self {
            id: ID(value.id.to_string()),
            link_id: ID(value.link_id.to_string()),
            name: value.name.clone(),
            email: value.email_address.clone(),
            sfs_photo_url: value.sfs_photo_url.clone(),
        }
    }
}

#[Object]
impl GraphqlSoupEmailParticipant {
    async fn id(&self) -> &ID {
        &self.id
    }

    async fn link_id(&self) -> &ID {
        &self.link_id
    }

    async fn name(&self) -> Option<&str> {
        self.name.as_deref()
    }

    async fn email(&self) -> Option<&str> {
        self.email.as_deref()
    }

    async fn sfs_photo_url(&self) -> Option<&str> {
        self.sfs_photo_url.as_deref()
    }
}

/// GraphQL email label.
pub struct GraphqlSoupEmailLabel {
    id: ID,
    link_id: ID,
    provider_label_id: String,
    name: String,
    created_at: String,
    message_list_visibility: &'static str,
    label_list_visibility: &'static str,
    type_: &'static str,
}

impl From<&SoupLabel> for GraphqlSoupEmailLabel {
    fn from(value: &SoupLabel) -> Self {
        Self {
            id: ID(value.id.to_string()),
            link_id: ID(value.link_id.to_string()),
            provider_label_id: value.provider_label_id.clone(),
            name: value.name.clone(),
            created_at: value.created_at.to_rfc3339(),
            message_list_visibility: match value.message_list_visibility {
                SoupMessageListVisibility::Show => "show",
                SoupMessageListVisibility::Hide => "hide",
            },
            label_list_visibility: match value.label_list_visibility {
                SoupLabelListVisibility::LabelShow => "label_show",
                SoupLabelListVisibility::LabelShowIfUnread => "label_show_if_unread",
                SoupLabelListVisibility::LabelHide => "label_hide",
            },
            type_: match value.type_ {
                SoupLabelType::System => "system",
                SoupLabelType::User => "user",
            },
        }
    }
}

#[Object]
impl GraphqlSoupEmailLabel {
    async fn id(&self) -> &ID {
        &self.id
    }

    async fn link_id(&self) -> &ID {
        &self.link_id
    }

    async fn provider_label_id(&self) -> &str {
        &self.provider_label_id
    }

    async fn name(&self) -> &str {
        &self.name
    }

    async fn created_at(&self) -> &str {
        &self.created_at
    }

    async fn message_list_visibility(&self) -> &'static str {
        self.message_list_visibility
    }

    async fn label_list_visibility(&self) -> &'static str {
        self.label_list_visibility
    }

    async fn type_(&self) -> &'static str {
        self.type_
    }
}

/// GraphQL email attachment.
pub struct GraphqlSoupEmailAttachment {
    id: ID,
    message_id: ID,
    provider_attachment_id: Option<String>,
    filename: Option<String>,
    mime_type: Option<String>,
    size_bytes: Option<i64>,
    content_id: Option<String>,
    created_at: String,
}

impl From<&SoupAttachment> for GraphqlSoupEmailAttachment {
    fn from(value: &SoupAttachment) -> Self {
        Self {
            id: ID(value.id.to_string()),
            message_id: ID(value.message_id.to_string()),
            provider_attachment_id: value.provider_attachment_id.clone(),
            filename: value.filename.clone(),
            mime_type: value.mime_type.clone(),
            size_bytes: value.size_bytes,
            content_id: value.content_id.clone(),
            created_at: value.created_at.to_rfc3339(),
        }
    }
}

#[Object]
impl GraphqlSoupEmailAttachment {
    async fn id(&self) -> &ID {
        &self.id
    }

    async fn message_id(&self) -> &ID {
        &self.message_id
    }

    async fn provider_attachment_id(&self) -> Option<&str> {
        self.provider_attachment_id.as_deref()
    }

    async fn filename(&self) -> Option<&str> {
        self.filename.as_deref()
    }

    async fn mime_type(&self) -> Option<&str> {
        self.mime_type.as_deref()
    }

    async fn size_bytes(&self) -> Option<i64> {
        self.size_bytes
    }

    async fn content_id(&self) -> Option<&str> {
        self.content_id.as_deref()
    }

    async fn created_at(&self) -> &str {
        &self.created_at
    }
}

/// GraphQL email thread entity.
pub struct GraphqlSoupEmailThread(SoupEnrichedEmailThreadPreview);

#[Object]
impl GraphqlSoupEmailThread {
    async fn id(&self) -> ID {
        ID(self.0.thread.id.to_string())
    }

    async fn provider_id(&self) -> Option<&str> {
        self.0.thread.provider_id.as_deref()
    }

    async fn owner_id(&self) -> String {
        self.0.thread.owner_id.as_ref().to_owned()
    }

    async fn inbox_visible(&self) -> bool {
        self.0.thread.inbox_visible
    }

    async fn link_id(&self) -> Option<ID> {
        self.0
            .participants
            .first()
            .map(|participant| participant.link_id)
            .or_else(|| self.0.labels.first().map(|label| label.link_id))
            .map(|id| ID(id.to_string()))
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

    async fn sender_photo_url(&self) -> Option<&str> {
        self.0.thread.sender_photo_url.as_deref()
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

    async fn participants(&self) -> Vec<GraphqlSoupEmailParticipant> {
        self.0
            .participants
            .iter()
            .map(GraphqlSoupEmailParticipant::from)
            .collect()
    }

    async fn attachments(&self) -> Vec<GraphqlSoupEmailAttachment> {
        self.0
            .attachments
            .iter()
            .map(GraphqlSoupEmailAttachment::from)
            .collect()
    }

    async fn labels(&self) -> Vec<GraphqlSoupEmailLabel> {
        self.0
            .labels
            .iter()
            .map(GraphqlSoupEmailLabel::from)
            .collect()
    }

    async fn properties(&self) -> Vec<GraphqlSoupProperty> {
        self.0
            .properties
            .iter()
            .cloned()
            .map(GraphqlSoupProperty)
            .collect()
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

/// GraphQL channel participant.
pub struct GraphqlSoupChannelParticipant(ChannelParticipant);

#[Object]
impl GraphqlSoupChannelParticipant {
    async fn channel_id(&self) -> ID {
        ID(self.0.channel_id.0.to_string())
    }

    async fn user_id(&self) -> String {
        self.0.user_id.as_ref().to_owned()
    }

    async fn role(&self) -> &'static str {
        match self.0.role {
            models_soup::comms::ParticipantRole::Owner => "owner",
            models_soup::comms::ParticipantRole::Admin => "admin",
            models_soup::comms::ParticipantRole::Member => "member",
        }
    }

    async fn joined_at(&self) -> String {
        self.0.joined_at.to_rfc3339()
    }

    async fn left_at(&self) -> Option<String> {
        self.0.left_at.map(|ts| ts.to_rfc3339())
    }
}

/// GraphQL channel message summary.
pub struct GraphqlSoupChannelMessage(ChannelMessage);

// NOTE: `id` (not `messageId`) — objects exposing `id: ID!` are treated as
// normalized entities by clients' caches (presence-of-id convention).

#[Object]
impl GraphqlSoupChannelMessage {
    async fn id(&self) -> ID {
        ID(self.0.message_id.to_string())
    }

    async fn thread_id(&self) -> Option<ID> {
        self.0.thread_id.map(|id| ID(id.to_string()))
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

    async fn deleted_at(&self) -> Option<String> {
        self.0.deleted_at.map(|ts| ts.to_rfc3339())
    }

    async fn mentions(&self) -> &[String] {
        &self.0.mentions
    }
}

/// GraphQL channel entity.
pub struct GraphqlSoupChannel(SoupChannel);

impl GraphqlSoupChannel {
    fn channel_type_name(channel_type: ChannelType) -> &'static str {
        match channel_type {
            ChannelType::Public => "public",
            ChannelType::Private => "private",
            ChannelType::DirectMessage => "direct_message",
            ChannelType::Team => "team",
        }
    }
}

#[Object]
impl GraphqlSoupChannel {
    async fn id(&self) -> ID {
        ID(self.0.channel.channel.id.0.to_string())
    }

    async fn name(&self) -> Option<&str> {
        self.0.channel.channel.name.as_deref()
    }

    async fn channel_type(&self) -> &'static str {
        Self::channel_type_name(self.0.channel.channel.channel_type)
    }

    async fn owner_id(&self) -> String {
        self.0.channel.channel.owner_id.as_ref().to_owned()
    }

    async fn organization_id(&self) -> Option<ID> {
        self.0
            .channel
            .channel
            .org_id
            .as_ref()
            .map(|id| ID(id.0.to_string()))
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

    async fn interacted_at(&self) -> Option<String> {
        self.0.interacted_at.map(|ts| ts.to_rfc3339())
    }

    async fn participant_count(&self) -> usize {
        self.0.channel.participants.len()
    }

    async fn participant_ids(&self) -> Vec<String> {
        self.0
            .channel
            .participants
            .iter()
            .map(|participant| participant.user_id.as_ref().to_owned())
            .collect()
    }

    async fn participants(&self) -> Vec<GraphqlSoupChannelParticipant> {
        self.0
            .channel
            .participants
            .iter()
            .cloned()
            .map(GraphqlSoupChannelParticipant)
            .collect()
    }

    async fn latest_message(&self) -> Option<GraphqlSoupChannelMessage> {
        self.0
            .latest_message
            .latest_message
            .clone()
            .map(GraphqlSoupChannelMessage)
    }

    async fn latest_non_thread_message(&self) -> Option<GraphqlSoupChannelMessage> {
        self.0
            .latest_message
            .latest_non_thread_message
            .clone()
            .map(GraphqlSoupChannelMessage)
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

/// GraphQL call participant.
pub struct GraphqlSoupCallParticipant {
    user_id: String,
    joined_at: String,
    left_at: Option<String>,
}

impl From<&SoupCallRecordParticipant> for GraphqlSoupCallParticipant {
    fn from(value: &SoupCallRecordParticipant) -> Self {
        Self {
            user_id: value.user_id.clone(),
            joined_at: value.joined_at.to_rfc3339(),
            left_at: value.left_at.map(|ts| ts.to_rfc3339()),
        }
    }
}

#[Object]
impl GraphqlSoupCallParticipant {
    async fn user_id(&self) -> &str {
        &self.user_id
    }

    async fn joined_at(&self) -> &str {
        &self.joined_at
    }

    async fn left_at(&self) -> Option<&str> {
        self.left_at.as_deref()
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

    async fn channel_name(&self) -> Option<&str> {
        self.0.channel_name.as_deref()
    }

    async fn created_by(&self) -> &str {
        &self.0.created_by
    }

    async fn custom_name(&self) -> Option<&str> {
        self.0.custom_name.as_deref()
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

    async fn status(&self) -> &'static str {
        match self.0.status {
            item_filters::CallStatus::Attended => "ATTENDED",
            item_filters::CallStatus::Missed => "MISSED",
            item_filters::CallStatus::Unattended => "UNATTENDED",
        }
    }

    async fn attended(&self) -> bool {
        self.0.attended
    }

    async fn participant_count(&self) -> usize {
        self.0.participants.len()
    }

    async fn participant_ids(&self) -> Vec<String> {
        self.0
            .participants
            .iter()
            .map(|participant| participant.user_id.clone())
            .collect()
    }

    async fn participants(&self) -> Vec<GraphqlSoupCallParticipant> {
        self.0
            .participants
            .iter()
            .map(GraphqlSoupCallParticipant::from)
            .collect()
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

    async fn properties(&self) -> Vec<GraphqlSoupProperty> {
        self.0
            .properties
            .iter()
            .cloned()
            .map(GraphqlSoupProperty)
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

#[cfg(test)]
mod tests;
