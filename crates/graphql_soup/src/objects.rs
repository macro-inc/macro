use async_graphql::{Context, ID, Interface, Json, Object, ObjectType, OutputType, SimpleObject};
use graphql_common::{GraphqlEntityType, GraphqlSoupEntityType};
use graphql_permission::GraphqlEntityPermission;
use models_pagination::PaginatedOpaqueCursor;
use models_soup::{
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
use serde_json::Value;
use soup::domain::models::{EnrichedSoupItem, SoupPropertiesField, grouping::NestedSoupGroups};
use uuid::Uuid;

/// Extension fields attached to every top-level Soup entity.
///
/// The concrete edge object is supplied by the schema composition crate and
/// flattened into each Soup entity's GraphQL fields.
pub trait SoupEntityEdges: ObjectType + Clone + Send + Sync + 'static {
    /// GraphQL property object supplied by the property adapter.
    type Property: OutputType;

    /// GraphQL notification object supplied by the notification adapter.
    type Notification: OutputType;

    /// Construct the common/global edge object for a Soup entity.
    /// This is for edges that apply to all soup entities, e.g. notifications
    fn from_entity(entity: model_entity::Entity<'static>) -> Self;

    /// Construct common/global edges for a channel message whose viewer
    /// permission is inherited from its parent channel.
    fn from_channel_message(message_id: Uuid, channel_id: Uuid) -> Self {
        let _ = channel_id;
        Self::from_entity(
            model_entity::EntityType::ChannelMessage.with_entity_string(message_id.to_string()),
        )
    }

    /// Additional fields attached only to email-thread entities.
    type EmailThreadEdges: ObjectType + Clone + Send + Sync + 'static;

    /// Construct the email-thread-specific edge object.
    fn email_thread_edges(email_thread_id: Uuid) -> Self::EmailThreadEdges;

    /// Resolve properties assigned to this entity.
    fn resolve_properties(
        &self,
        ctx: &Context<'_>,
    ) -> impl Future<Output = async_graphql::Result<Vec<Self::Property>>> + Send;

    /// Resolve notifications associated with this entity.
    fn resolve_notifications(
        &self,
        ctx: &Context<'_>,
    ) -> impl Future<Output = async_graphql::Result<Vec<Self::Notification>>> + Send;

    /// Resolve whether the authenticated viewer has favorited this entity.
    fn resolve_is_favorited(
        &self,
        ctx: &Context<'_>,
    ) -> impl Future<Output = async_graphql::Result<bool>> + Send;

    /// Resolve the authenticated viewer's effective permission.
    fn resolve_viewer_permission(
        &self,
        ctx: &Context<'_>,
    ) -> impl Future<Output = async_graphql::Result<Option<GraphqlEntityPermission>>> + Send;
}

/// Page returned by `Query.soup`.
#[derive(SimpleObject)]
pub struct SoupPage<E: SoupEntityEdges> {
    /// Items in the current page.
    items: Vec<GraphqlSoupEntity<E>>,
    /// Opaque cursor for the next page, if one exists.
    next_cursor: Option<String>,
    /// Whether more items are available after this page.
    has_more: bool,
}

impl<E: SoupEntityEdges> From<PaginatedOpaqueCursor<SoupItem<()>>> for SoupPage<E> {
    fn from(page: PaginatedOpaqueCursor<SoupItem<()>>) -> Self {
        let has_more = page.next_cursor.is_some();
        Self {
            items: page
                .items
                .into_iter()
                .map(GraphqlSoupEntity::from)
                .collect(),
            next_cursor: page.next_cursor,
            has_more,
        }
    }
}

impl<E: SoupEntityEdges> From<PaginatedOpaqueCursor<EnrichedSoupItem>> for SoupPage<E> {
    fn from(page: PaginatedOpaqueCursor<EnrichedSoupItem>) -> Self {
        let has_more = page.next_cursor.is_some();
        Self {
            items: page
                .items
                .into_iter()
                .map(GraphqlSoupEntity::from)
                .collect(),
            next_cursor: page.next_cursor,
            has_more,
        }
    }
}

/// GraphQL representation of grouped Soup items.
#[derive(SimpleObject)]
pub struct GroupedSoup<E: SoupEntityEdges> {
    /// Bins containing the grouped Soup items.
    bins: Vec<GraphqlSoupBin<E>>,
}

impl<E: SoupEntityEdges> From<NestedSoupGroups<SoupPropertiesField>> for GroupedSoup<E> {
    fn from(groups: NestedSoupGroups<SoupPropertiesField>) -> Self {
        Self {
            bins: groups
                .into_bins()
                .map(|(key, bin)| GraphqlSoupBin {
                    key,
                    total_count: bin.group_total_size(),
                    next_cursor: bin.next_cursor().map(ToOwned::to_owned),
                    items: bin
                        .into_items()
                        .map(|item| GraphqlSoupEntity::from(item.map_extra(|_| ())))
                        .collect(),
                })
                .collect(),
        }
    }
}

/// GraphQL representation of a Soup group bin.
#[derive(SimpleObject)]
pub struct GraphqlSoupBin<E: SoupEntityEdges> {
    /// The grouping key.
    key: String,
    /// Total number of items in this group across all pages.
    total_count: usize,
    /// Opaque cursor for the next page in this bin, if one exists.
    next_cursor: Option<String>,
    /// Items in this bin, ordered by their index within the group.
    items: Vec<GraphqlSoupEntity<E>>,
}

impl<E> From<EnrichedSoupItem> for GraphqlSoupEntity<E>
where
    E: SoupEntityEdges,
{
    fn from(item: EnrichedSoupItem) -> Self {
        let EnrichedSoupItem {
            item,
            frecency_score,
            ..
        } = item;
        let score = frecency_score.map(|f| f.data.frecency_score);
        Self::from(item.map_extra(|_| ())).with_frecency(score)
    }
}

impl<E: SoupEntityEdges> GraphqlSoupEntity<E> {
    /// Attach the viewer's frecency score for this entity.
    fn with_frecency(mut self, score: Option<f64>) -> Self {
        match &mut self {
            Self::Document(entity) => entity.2 = score,
            Self::Chat(entity) => entity.2 = score,
            Self::Project(entity) => entity.2 = score,
            Self::EmailThread(entity) => entity.2 = score,
            Self::Channel(entity) => entity.2 = score,
            Self::ChannelMessage(entity) => entity.2 = score,
            Self::Call(entity) => entity.2 = score,
            Self::CrmCompany(entity) => entity.2 = score,
            Self::ForeignEntity(entity) => entity.2 = score,
        }
        self
    }
}

/// Reference to another canonical entity embedded in entity metadata.
#[derive(SimpleObject)]
pub struct GraphqlEntityRef {
    /// Referenced entity kind.
    entity_type: GraphqlEntityType,
    /// Referenced canonical identifier.
    entity_id: ID,
}

impl GraphqlEntityRef {
    /// Construct an embedded entity reference.
    fn new(entity_type: impl Into<GraphqlEntityType>, entity_id: impl ToString) -> Self {
        Self {
            entity_type: entity_type.into(),
            entity_id: ID(entity_id.to_string()),
        }
    }
}

/// Metadata shared by every canonical Soup entity.
#[derive(SimpleObject)]
pub struct GraphqlEntityMetadata {
    /// Owning user, when applicable.
    owner_id: Option<String>,
    /// Parent project, channel, or team, when applicable.
    parent: Option<GraphqlEntityRef>,
    /// Creation timestamp in RFC 3339 form.
    created_at: Option<String>,
    /// Last-update timestamp in RFC 3339 form.
    updated_at: Option<String>,
    /// Last-viewed timestamp in RFC 3339 form.
    viewed_at: Option<String>,
    /// Soft-deletion timestamp in RFC 3339 form.
    deleted_at: Option<String>,
}

/// Common GraphQL interface over canonical Soup entity variants.
#[derive(Interface)]
#[graphql(
    field(name = "id", ty = "ID", desc = "The canonical entity identifier."),
    field(
        name = "entity_type",
        ty = "GraphqlSoupEntityType",
        desc = "The canonical entity type."
    ),
    field(
        name = "display_name",
        ty = "Option<String>",
        desc = "The user-facing entity name, when available."
    ),
    field(
        name = "metadata",
        ty = "GraphqlEntityMetadata",
        desc = "Metadata shared across entity variants."
    ),
    field(
        name = "properties",
        method = "interface_properties",
        ty = "Vec<E::Property>",
        desc = "Properties assigned to this entity that the viewer may access."
    ),
    field(
        name = "notifications",
        method = "interface_notifications",
        ty = "Vec<E::Notification>",
        desc = "Notifications associated with this entity for the current viewer."
    ),
    field(
        name = "isFavorited",
        method = "interface_is_favorited",
        ty = "bool",
        desc = "Whether the current viewer has favorited this entity."
    ),
    field(
        name = "viewerPermission",
        method = "interface_viewer_permission",
        ty = "Option<GraphqlEntityPermission>",
        desc = "The current viewer's effective permission for this entity."
    ),
    field(
        name = "frecencyScore",
        method = "frecency_score",
        ty = "Option<f64>",
        desc = "The viewer's frecency score for this entity, when loaded."
    )
)]
pub enum GraphqlSoupEntity<E: SoupEntityEdges> {
    /// Document entity.
    Document(GraphqlSoupDocument<E>),
    /// Chat entity.
    Chat(GraphqlSoupChat<E>),
    /// Project entity.
    Project(GraphqlSoupProject<E>),
    /// Email thread entity.
    EmailThread(GraphqlSoupEmailThread<E>),
    /// Channel entity.
    Channel(GraphqlSoupChannel<E>),
    /// Canonical channel-message entity.
    ChannelMessage(GraphqlSoupChannelMessage<E>),
    /// Call entity.
    Call(GraphqlSoupCall<E>),
    /// CRM company entity.
    CrmCompany(GraphqlSoupCrmCompany<E>),
    /// Foreign entity.
    ForeignEntity(GraphqlSoupForeignEntity<E>),
}

impl<E> From<SoupItem<()>> for GraphqlSoupEntity<E>
where
    E: SoupEntityEdges,
{
    fn from(item: SoupItem<()>) -> Self {
        match item {
            SoupItem::Document(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::Document.with_entity_string(item.id.to_string()),
                );
                Self::Document(GraphqlSoupDocument(item, edges, None))
            }
            SoupItem::Chat(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::Chat.with_entity_string(item.id.to_string()),
                );
                Self::Chat(GraphqlSoupChat(item, edges, None))
            }
            SoupItem::Project(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::Project.with_entity_string(item.id.to_string()),
                );
                Self::Project(GraphqlSoupProject(item, edges, None))
            }
            SoupItem::EmailThread(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::EmailThread
                        .with_entity_string(item.thread.id.to_string()),
                );
                Self::EmailThread(GraphqlSoupEmailThread(item, edges, None))
            }
            SoupItem::Channel(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::Channel
                        .with_entity_string(item.channel.channel.id.0.to_string()),
                );
                Self::Channel(GraphqlSoupChannel(item, edges, None))
            }
            SoupItem::ChannelThread(item) => {
                let edges = E::from_channel_message(item.id, item.channel_id);
                Self::ChannelMessage(GraphqlSoupChannelMessage(item, edges, None))
            }
            SoupItem::Call(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::Call.with_entity_string(item.call_id.to_string()),
                );
                Self::Call(GraphqlSoupCall(item, edges, None))
            }
            SoupItem::CrmCompany(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::CrmCompany.with_entity_string(item.id.to_string()),
                );
                Self::CrmCompany(GraphqlSoupCrmCompany(item, edges, None))
            }
            SoupItem::ForeignEntity(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::ForeignEntity.with_entity_string(item.id.to_string()),
                );
                Self::ForeignEntity(GraphqlSoupForeignEntity(item, edges, None))
            }
        }
    }
}

/// GraphQL document entity.
pub struct GraphqlSoupDocument<E: SoupEntityEdges>(SoupDocument<()>, E, Option<f64>);

/// GraphQL representation of the soup document.
#[Object(name = "GraphqlSoupDocument")]
impl<E> GraphqlSoupDocument<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    /// Canonical entity kind.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::Document
    }

    /// User-visible display name.
    async fn display_name(&self) -> Option<String> {
        Some(self.0.name.clone())
    }

    /// Common document metadata.
    async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: Some(self.0.owner_id.as_ref().to_owned()),
            parent: self
                .0
                .project_id
                .map(|id| GraphqlEntityRef::new(GraphqlSoupEntityType::Project, id)),
            created_at: Some(self.0.created_at.to_rfc3339()),
            updated_at: Some(self.0.updated_at.to_rfc3339()),
            viewed_at: self.0.viewed_at.map(|ts| ts.to_rfc3339()),
            deleted_at: self.0.deleted_at.map(|ts| ts.to_rfc3339()),
        }
    }

    /// The name.
    async fn name(&self) -> &str {
        &self.0.name
    }

    /// The identifier of the owner.
    async fn owner_id(&self) -> String {
        self.0.owner_id.as_ref().to_owned()
    }

    /// The file type.
    async fn file_type(&self) -> Option<&str> {
        self.0.file_type.as_deref()
    }

    /// The identifier of the project.
    async fn project_id(&self) -> Option<ID> {
        self.0.project_id.map(|id| ID(id.to_string()))
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    /// The viewed timestamp in RFC 3339 format.
    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    /// The deleted timestamp in RFC 3339 format.
    async fn deleted_at(&self) -> Option<String> {
        self.0.deleted_at.map(|ts| ts.to_rfc3339())
    }

    /// The sub type.
    async fn sub_type(&self) -> Option<GraphqlSoupDocumentSubType> {
        self.0
            .sub_type
            .as_ref()
            .map(GraphqlSoupDocumentSubType::from)
    }

    #[graphql(flatten)]
    /// The edges.
    async fn edges(&self) -> E {
        self.1.clone()
    }

    /// The viewer's frecency score for this entity, when loaded.
    async fn frecency_score(&self) -> Option<f64> {
        self.2
    }
}

/// GraphQL representation of the soup document sub type.
#[derive(SimpleObject)]
pub struct GraphqlSoupDocumentSubType {
    /// The kind.
    kind: &'static str,
    /// Whether the task is completed.
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

/// GraphQL chat entity.
pub struct GraphqlSoupChat<E: SoupEntityEdges>(SoupChat<()>, E, Option<f64>);

/// GraphQL representation of the soup chat.
#[Object(name = "GraphqlSoupChat")]
impl<E> GraphqlSoupChat<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    /// Canonical entity kind.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::Chat
    }

    /// User-visible display name.
    async fn display_name(&self) -> Option<String> {
        Some(self.0.name.clone())
    }

    /// Common chat metadata.
    async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: Some(self.0.owner_id.as_ref().to_owned()),
            parent: self
                .0
                .project_id
                .map(|id| GraphqlEntityRef::new(GraphqlSoupEntityType::Project, id)),
            created_at: Some(self.0.created_at.to_rfc3339()),
            updated_at: Some(self.0.updated_at.to_rfc3339()),
            viewed_at: self.0.viewed_at.map(|ts| ts.to_rfc3339()),
            deleted_at: self.0.deleted_at.map(|ts| ts.to_rfc3339()),
        }
    }

    /// The name.
    async fn name(&self) -> &str {
        &self.0.name
    }

    /// The identifier of the owner.
    async fn owner_id(&self) -> String {
        self.0.owner_id.as_ref().to_owned()
    }

    /// The identifier of the project.
    async fn project_id(&self) -> Option<ID> {
        self.0.project_id.map(|id| ID(id.to_string()))
    }

    /// Whether the chat is persistent.
    async fn is_persistent(&self) -> bool {
        self.0.is_persistent
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    /// The viewed timestamp in RFC 3339 format.
    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    /// The deleted timestamp in RFC 3339 format.
    async fn deleted_at(&self) -> Option<String> {
        self.0.deleted_at.map(|ts| ts.to_rfc3339())
    }

    #[graphql(flatten)]
    /// The edges.
    async fn edges(&self) -> E {
        self.1.clone()
    }

    /// The viewer's frecency score for this entity, when loaded.
    async fn frecency_score(&self) -> Option<f64> {
        self.2
    }
}

/// GraphQL project entity.
pub struct GraphqlSoupProject<E: SoupEntityEdges>(SoupProject<()>, E, Option<f64>);

/// GraphQL representation of the soup project.
#[Object(name = "GraphqlSoupProject")]
impl<E> GraphqlSoupProject<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    /// Canonical entity kind.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::Project
    }

    /// User-visible display name.
    async fn display_name(&self) -> Option<String> {
        Some(self.0.name.clone())
    }

    /// Common project metadata.
    async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: Some(self.0.owner_id.as_ref().to_owned()),
            parent: self
                .0
                .parent_id
                .map(|id| GraphqlEntityRef::new(GraphqlSoupEntityType::Project, id)),
            created_at: Some(self.0.created_at.to_rfc3339()),
            updated_at: Some(self.0.updated_at.to_rfc3339()),
            viewed_at: self.0.viewed_at.map(|ts| ts.to_rfc3339()),
            deleted_at: self.0.deleted_at.map(|ts| ts.to_rfc3339()),
        }
    }

    /// The name.
    async fn name(&self) -> &str {
        &self.0.name
    }

    /// The identifier of the owner.
    async fn owner_id(&self) -> String {
        self.0.owner_id.as_ref().to_owned()
    }

    /// The identifier of the parent.
    async fn parent_id(&self) -> Option<ID> {
        self.0.parent_id.map(|id| ID(id.to_string()))
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    /// The viewed timestamp in RFC 3339 format.
    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    /// The deleted timestamp in RFC 3339 format.
    async fn deleted_at(&self) -> Option<String> {
        self.0.deleted_at.map(|ts| ts.to_rfc3339())
    }

    #[graphql(flatten)]
    /// The edges.
    async fn edges(&self) -> E {
        self.1.clone()
    }

    /// The viewer's frecency score for this entity, when loaded.
    async fn frecency_score(&self) -> Option<f64> {
        self.2
    }
}

/// GraphQL representation of the soup email participant.
#[derive(SimpleObject)]
pub struct GraphqlSoupEmailParticipant {
    /// The unique identifier.
    id: ID,
    /// The identifier of the link.
    link_id: ID,
    /// The name.
    name: Option<String>,
    /// The email.
    email: Option<String>,
    /// The sfs photo url.
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

/// GraphQL representation of the soup email label.
#[derive(SimpleObject)]
pub struct GraphqlSoupEmailLabel {
    /// The unique identifier.
    id: ID,
    /// The identifier of the link.
    link_id: ID,
    /// The identifier of the provider label.
    provider_label_id: String,
    /// The name.
    name: String,
    /// The created timestamp in RFC 3339 format.
    created_at: String,
    /// The message list visibility.
    message_list_visibility: &'static str,
    /// The label list visibility.
    label_list_visibility: &'static str,
    /// The type.
    #[graphql(name = "type")]
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

/// GraphQL representation of the soup email attachment.
#[derive(SimpleObject)]
pub struct GraphqlSoupEmailAttachment {
    /// The unique identifier.
    id: ID,
    /// The identifier of the message.
    message_id: ID,
    /// The identifier of the provider attachment.
    provider_attachment_id: Option<String>,
    /// The filename.
    filename: Option<String>,
    /// The mime type.
    mime_type: Option<String>,
    /// The size bytes.
    size_bytes: Option<i64>,
    /// The identifier of the content.
    content_id: Option<String>,
    /// The created timestamp in RFC 3339 format.
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

/// GraphQL email thread entity.
pub struct GraphqlSoupEmailThread<E: SoupEntityEdges>(
    SoupEnrichedEmailThreadPreview<()>,
    E,
    Option<f64>,
);

/// GraphQL representation of the soup email thread.
#[Object(name = "GraphqlSoupEmailThread")]
impl<E> GraphqlSoupEmailThread<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.thread.id.to_string())
    }

    /// Canonical entity kind.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::EmailThread
    }

    /// User-visible display name.
    async fn display_name(&self) -> Option<String> {
        self.0.thread.name.clone()
    }

    /// Common email-thread metadata.
    async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: Some(self.0.thread.owner_id.as_ref().to_owned()),
            parent: self
                .0
                .thread
                .project_id
                .as_ref()
                .map(|id| GraphqlEntityRef::new(GraphqlSoupEntityType::Project, id)),
            created_at: Some(self.0.thread.created_at.to_rfc3339()),
            updated_at: Some(self.0.thread.updated_at.to_rfc3339()),
            viewed_at: self.0.thread.viewed_at.map(|ts| ts.to_rfc3339()),
            deleted_at: None,
        }
    }

    /// The identifier of the provider.
    async fn provider_id(&self) -> Option<&str> {
        self.0.thread.provider_id.as_deref()
    }

    /// The identifier of the owner.
    async fn owner_id(&self) -> String {
        self.0.thread.owner_id.as_ref().to_owned()
    }

    /// Whether the thread should appear in the inbox.
    async fn inbox_visible(&self) -> bool {
        self.0.thread.inbox_visible
    }

    /// The identifier of the link.
    async fn link_id(&self) -> Option<ID> {
        self.0
            .participants
            .first()
            .map(|participant| participant.link_id)
            .or_else(|| self.0.labels.first().map(|label| label.link_id))
            .map(|id| ID(id.to_string()))
    }

    /// The name.
    async fn name(&self) -> Option<&str> {
        self.0.thread.name.as_deref()
    }

    /// The snippet.
    async fn snippet(&self) -> Option<&str> {
        self.0.thread.snippet.as_deref()
    }

    /// The sender email.
    async fn sender_email(&self) -> Option<&str> {
        self.0.thread.sender_email.as_deref()
    }

    /// The sender name.
    async fn sender_name(&self) -> Option<&str> {
        self.0.thread.sender_name.as_deref()
    }

    /// The sender photo url.
    async fn sender_photo_url(&self) -> Option<&str> {
        self.0.thread.sender_photo_url.as_deref()
    }

    /// Whether the thread has been read.
    async fn is_read(&self) -> bool {
        self.0.thread.is_read
    }

    /// Whether the thread contains a draft.
    async fn is_draft(&self) -> bool {
        self.0.thread.is_draft
    }

    /// Whether the thread is marked important.
    async fn is_important(&self) -> bool {
        self.0.thread.is_important
    }

    /// The identifier of the project.
    async fn project_id(&self) -> Option<ID> {
        self.0.thread.project_id.as_ref().map(|id| ID(id.clone()))
    }

    /// Timestamp used for email thread sorting, in RFC 3339 format.
    async fn sort_ts(&self) -> String {
        self.0.thread.sort_ts.to_rfc3339()
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.thread.created_at.to_rfc3339()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.thread.updated_at.to_rfc3339()
    }

    /// The viewed timestamp in RFC 3339 format.
    async fn viewed_at(&self) -> Option<String> {
        self.0.thread.viewed_at.map(|ts| ts.to_rfc3339())
    }

    /// The attachment count.
    async fn attachment_count(&self) -> usize {
        self.0.attachments.len()
    }

    /// The participant count.
    async fn participant_count(&self) -> usize {
        self.0.participants.len()
    }

    /// The participants.
    async fn participants(&self) -> Vec<GraphqlSoupEmailParticipant> {
        self.0
            .participants
            .iter()
            .map(GraphqlSoupEmailParticipant::from)
            .collect()
    }

    /// The attachments.
    async fn attachments(&self) -> Vec<GraphqlSoupEmailAttachment> {
        self.0
            .attachments
            .iter()
            .map(GraphqlSoupEmailAttachment::from)
            .collect()
    }

    /// The labels.
    async fn labels(&self) -> Vec<GraphqlSoupEmailLabel> {
        self.0
            .labels
            .iter()
            .map(GraphqlSoupEmailLabel::from)
            .collect()
    }

    #[graphql(flatten)]
    /// The edges.
    async fn edges(&self) -> E {
        self.1.clone()
    }

    /// The viewer's frecency score for this entity, when loaded.
    async fn frecency_score(&self) -> Option<f64> {
        self.2
    }

    /// the email thread edge
    #[graphql(flatten)]
    async fn email_thread_edges(&self) -> E::EmailThreadEdges {
        E::email_thread_edges(self.0.thread.id)
    }
}

/// GraphQL channel participant.
pub struct GraphqlSoupChannelParticipant(ChannelParticipant);

/// GraphQL representation of the soup channel participant.
#[Object]
impl GraphqlSoupChannelParticipant {
    /// The identifier of the channel.
    async fn channel_id(&self) -> ID {
        ID(self.0.channel_id.0.to_string())
    }

    /// The identifier of the user.
    async fn user_id(&self) -> String {
        self.0.user_id.as_ref().to_owned()
    }

    /// The role.
    async fn role(&self) -> &'static str {
        match self.0.role {
            models_soup::comms::ParticipantRole::Owner => "owner",
            models_soup::comms::ParticipantRole::Admin => "admin",
            models_soup::comms::ParticipantRole::Member => "member",
        }
    }

    /// The joined timestamp in RFC 3339 format.
    async fn joined_at(&self) -> String {
        self.0.joined_at.to_rfc3339()
    }

    /// The left timestamp in RFC 3339 format.
    async fn left_at(&self) -> Option<String> {
        self.0.left_at.map(|ts| ts.to_rfc3339())
    }
}

/// Embedded, non-normalized channel-message preview.
///
/// This exposes `messageId`, not `id`, so partial preview data cannot
/// overwrite a canonical channel-message record in normalized caches.
pub struct GraphqlSoupChannelMessagePreview {
    /// Partial message projection returned with a channel.
    message: ChannelMessage,
    /// Parent channel identity omitted by the REST preview projection.
    channel_id: Uuid,
}

impl GraphqlSoupChannelMessagePreview {
    /// Construct an embedded preview with its parent channel identity.
    fn new(message: ChannelMessage, channel_id: Uuid) -> Self {
        Self {
            message,
            channel_id,
        }
    }
}

/// GraphQL representation of the soup channel message.
#[Object]
impl GraphqlSoupChannelMessagePreview {
    /// The projected message identifier.
    async fn message_id(&self) -> ID {
        ID(self.message.message_id.to_string())
    }

    /// The parent channel identifier.
    async fn channel_id(&self) -> ID {
        ID(self.channel_id.to_string())
    }

    /// The identifier of the thread.
    async fn thread_id(&self) -> Option<ID> {
        self.message.thread_id.map(|id| ID(id.to_string()))
    }

    /// The identifier of the sender.
    async fn sender_id(&self) -> &str {
        &self.message.sender_id
    }

    /// The content.
    async fn content(&self) -> &str {
        &self.message.content
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.message.created_at.to_rfc3339()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.message.updated_at.to_rfc3339()
    }

    /// The deleted timestamp in RFC 3339 format.
    async fn deleted_at(&self) -> Option<String> {
        self.message.deleted_at.map(|ts| ts.to_rfc3339())
    }

    /// The mentions.
    async fn mentions(&self) -> &[String] {
        &self.message.mentions
    }
}

/// GraphQL channel entity.
pub struct GraphqlSoupChannel<E: SoupEntityEdges>(SoupChannel, E, Option<f64>);

impl<E: SoupEntityEdges> GraphqlSoupChannel<E> {
    /// Return the stable GraphQL name for a channel type.
    fn channel_type_name(channel_type: ChannelType) -> &'static str {
        match channel_type {
            ChannelType::Public => "public",
            ChannelType::Private => "private",
            ChannelType::DirectMessage => "direct_message",
            ChannelType::Team => "team",
        }
    }
}

/// GraphQL representation of the soup channel.
#[Object(name = "GraphqlSoupChannel")]
impl<E> GraphqlSoupChannel<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.channel.channel.id.0.to_string())
    }

    /// Canonical entity kind.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::Channel
    }

    /// User-visible display name.
    async fn display_name(&self) -> Option<String> {
        self.0.channel.channel.name.clone()
    }

    /// Common channel metadata.
    async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: Some(self.0.channel.channel.owner_id.as_ref().to_owned()),
            parent: self
                .0
                .channel
                .channel
                .team_id
                .map(|id| GraphqlEntityRef::new(GraphqlEntityType::Team, id)),
            created_at: Some(self.0.channel.channel.created_at.to_rfc3339()),
            updated_at: Some(self.0.channel.channel.updated_at.to_rfc3339()),
            viewed_at: self.0.viewed_at.map(|ts| ts.to_rfc3339()),
            deleted_at: None,
        }
    }

    /// The name.
    async fn name(&self) -> Option<&str> {
        self.0.channel.channel.name.as_deref()
    }

    /// The channel type.
    async fn channel_type(&self) -> &'static str {
        Self::channel_type_name(self.0.channel.channel.channel_type)
    }

    /// The identifier of the owner.
    async fn owner_id(&self) -> String {
        self.0.channel.channel.owner_id.as_ref().to_owned()
    }

    /// The identifier of the organization.
    async fn organization_id(&self) -> Option<ID> {
        self.0
            .channel
            .channel
            .org_id
            .as_ref()
            .map(|id| ID(id.0.to_string()))
    }

    /// The identifier of the team.
    async fn team_id(&self) -> Option<ID> {
        self.0.channel.channel.team_id.map(|id| ID(id.to_string()))
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.channel.channel.created_at.to_rfc3339()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.channel.channel.updated_at.to_rfc3339()
    }

    /// The viewed timestamp in RFC 3339 format.
    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    /// The interacted timestamp in RFC 3339 format.
    async fn interacted_at(&self) -> Option<String> {
        self.0.interacted_at.map(|ts| ts.to_rfc3339())
    }

    /// Whether the requesting user is an active participant of the channel.
    async fn is_participant(&self) -> bool {
        self.0.channel.is_participant
    }

    /// The participant count.
    async fn participant_count(&self) -> usize {
        self.0.channel.participants.len()
    }

    /// The identifiers of the participants.
    async fn participant_ids(&self) -> Vec<String> {
        self.0
            .channel
            .participants
            .iter()
            .map(|participant| participant.user_id.as_ref().to_owned())
            .collect()
    }

    /// The participants.
    async fn participants(&self) -> Vec<GraphqlSoupChannelParticipant> {
        self.0
            .channel
            .participants
            .iter()
            .cloned()
            .map(GraphqlSoupChannelParticipant)
            .collect()
    }

    /// The latest message.
    async fn latest_message(&self) -> Option<GraphqlSoupChannelMessagePreview> {
        let channel_id = self.0.channel.channel.id.0;
        self.0
            .latest_message
            .latest_message
            .clone()
            .map(|message| GraphqlSoupChannelMessagePreview::new(message, channel_id))
    }

    /// The latest non thread message.
    async fn latest_non_thread_message(&self) -> Option<GraphqlSoupChannelMessagePreview> {
        let channel_id = self.0.channel.channel.id.0;
        self.0
            .latest_message
            .latest_non_thread_message
            .clone()
            .map(|message| GraphqlSoupChannelMessagePreview::new(message, channel_id))
    }

    #[graphql(flatten)]
    /// The edges.
    async fn edges(&self) -> E {
        self.1.clone()
    }

    /// The viewer's frecency score for this entity, when loaded.
    async fn frecency_score(&self) -> Option<f64> {
        self.2
    }
}

/// Canonical GraphQL channel-message entity represented by a top-level Soup
/// thread row.
pub struct GraphqlSoupChannelMessage<E: SoupEntityEdges>(SoupChannelThread, E, Option<f64>);

/// GraphQL representation of the soup channel thread.
#[Object(name = "GraphqlSoupChannelMessage")]
impl<E> GraphqlSoupChannelMessage<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    /// Canonical entity kind.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::ChannelMessage
    }

    /// Channel messages do not have a separate display name.
    async fn display_name(&self) -> Option<String> {
        None
    }

    /// The message content.
    async fn content(&self) -> &str {
        &self.0.content
    }

    /// Common channel-message metadata.
    async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: Some(self.0.sender_id.clone()),
            parent: Some(GraphqlEntityRef::new(
                GraphqlSoupEntityType::Channel,
                self.0.channel_id,
            )),
            created_at: Some(self.0.created_at.to_rfc3339()),
            updated_at: Some(self.0.updated_at.to_rfc3339()),
            viewed_at: None,
            deleted_at: self.0.deleted_at.map(|ts| ts.to_rfc3339()),
        }
    }

    /// The identifier of the channel.
    async fn channel_id(&self) -> ID {
        ID(self.0.channel_id.to_string())
    }

    /// The identifier of the sender.
    async fn sender_id(&self) -> &str {
        &self.0.sender_id
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    /// The effective updated timestamp in RFC 3339 format.
    async fn effective_updated_at(&self) -> String {
        self.0.effective_updated_at().to_rfc3339()
    }

    /// The reply count.
    async fn reply_count(&self) -> i64 {
        self.0.thread.reply_count
    }

    #[graphql(flatten)]
    /// The edges.
    async fn edges(&self) -> E {
        self.1.clone()
    }

    /// The viewer's frecency score for this entity, when loaded.
    async fn frecency_score(&self) -> Option<f64> {
        self.2
    }
}

/// GraphQL representation of the soup call participant.
#[derive(SimpleObject)]
pub struct GraphqlSoupCallParticipant {
    /// The identifier of the user.
    user_id: String,
    /// The joined timestamp in RFC 3339 format.
    joined_at: String,
    /// The left timestamp in RFC 3339 format.
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

/// GraphQL call entity.
pub struct GraphqlSoupCall<E: SoupEntityEdges>(SoupCallRecord<()>, E, Option<f64>);

/// GraphQL representation of the soup call.
#[Object(name = "GraphqlSoupCall")]
impl<E> GraphqlSoupCall<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.call_id.to_string())
    }

    /// Canonical entity kind.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::Call
    }

    /// User-visible call name.
    async fn display_name(&self) -> Option<String> {
        self.0
            .custom_name
            .clone()
            .or_else(|| self.0.channel_name.clone())
    }

    /// Common call metadata.
    async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: Some(self.0.created_by.clone()),
            parent: Some(GraphqlEntityRef::new(
                GraphqlSoupEntityType::Channel,
                self.0.channel_id,
            )),
            created_at: Some(self.0.started_at.to_rfc3339()),
            updated_at: self.0.ended_at.map(|ts| ts.to_rfc3339()),
            viewed_at: None,
            deleted_at: None,
        }
    }

    /// The identifier of the channel.
    async fn channel_id(&self) -> ID {
        ID(self.0.channel_id.to_string())
    }

    /// The channel name.
    async fn channel_name(&self) -> Option<&str> {
        self.0.channel_name.as_deref()
    }

    /// The user who created the call.
    async fn created_by(&self) -> &str {
        &self.0.created_by
    }

    /// The custom name.
    async fn custom_name(&self) -> Option<&str> {
        self.0.custom_name.as_deref()
    }

    /// The name.
    async fn name(&self) -> Option<&str> {
        self.0
            .custom_name
            .as_deref()
            .or(self.0.channel_name.as_deref())
    }

    /// The summary.
    async fn summary(&self) -> Option<&str> {
        self.0.summary.as_deref()
    }

    /// The started timestamp in RFC 3339 format.
    async fn started_at(&self) -> String {
        self.0.started_at.to_rfc3339()
    }

    /// The ended timestamp in RFC 3339 format.
    async fn ended_at(&self) -> Option<String> {
        self.0.ended_at.map(|ts| ts.to_rfc3339())
    }

    /// The duration ms.
    async fn duration_ms(&self) -> Option<i64> {
        self.0.duration_ms
    }

    /// Whether the call is currently active.
    async fn is_active(&self) -> bool {
        self.0.is_active
    }

    /// The status.
    async fn status(&self) -> &'static str {
        match self.0.status {
            item_filters::CallStatus::Attended => "ATTENDED",
            item_filters::CallStatus::Missed => "MISSED",
            item_filters::CallStatus::Unattended => "UNATTENDED",
        }
    }

    /// Whether the requesting user attended this call.
    async fn attended(&self) -> bool {
        self.0.attended
    }

    /// The participant count.
    async fn participant_count(&self) -> usize {
        self.0.participants.len()
    }

    /// The identifiers of the participants.
    async fn participant_ids(&self) -> Vec<String> {
        self.0
            .participants
            .iter()
            .map(|participant| participant.user_id.clone())
            .collect()
    }

    /// The participants.
    async fn participants(&self) -> Vec<GraphqlSoupCallParticipant> {
        self.0
            .participants
            .iter()
            .map(GraphqlSoupCallParticipant::from)
            .collect()
    }

    #[graphql(flatten)]
    /// The edges.
    async fn edges(&self) -> E {
        self.1.clone()
    }

    /// The viewer's frecency score for this entity, when loaded.
    async fn frecency_score(&self) -> Option<f64> {
        self.2
    }
}

/// GraphQL CRM company entity.
pub struct GraphqlSoupCrmCompany<E: SoupEntityEdges>(SoupCrmCompany<()>, E, Option<f64>);

/// GraphQL representation of the soup crm company.
#[Object(name = "GraphqlSoupCrmCompany")]
impl<E> GraphqlSoupCrmCompany<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    /// Canonical entity kind.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::CrmCompany
    }

    /// User-visible company name.
    async fn display_name(&self) -> Option<String> {
        self.0.name.clone()
    }

    /// Common CRM-company metadata.
    async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: None,
            parent: Some(GraphqlEntityRef::new(
                GraphqlEntityType::Team,
                self.0.team_id,
            )),
            created_at: Some(self.0.created_at.to_rfc3339()),
            updated_at: Some(self.0.updated_at.to_rfc3339()),
            viewed_at: self.0.viewed_at.map(|ts| ts.to_rfc3339()),
            deleted_at: None,
        }
    }

    /// The identifier of the team.
    async fn team_id(&self) -> ID {
        ID(self.0.team_id.to_string())
    }

    /// The name.
    async fn name(&self) -> Option<&str> {
        self.0.name.as_deref()
    }

    /// The description.
    async fn description(&self) -> Option<&str> {
        self.0.description.as_deref()
    }

    /// Whether email sync is enabled for this company.
    async fn email_sync(&self) -> bool {
        self.0.email_sync
    }

    /// Whether the company is hidden from CRM listings.
    async fn hidden(&self) -> bool {
        self.0.hidden
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    /// The viewed timestamp in RFC 3339 format.
    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    /// The domains.
    async fn domains(&self) -> Vec<String> {
        self.0
            .domains
            .iter()
            .map(|domain| domain.domain.clone())
            .collect()
    }

    #[graphql(flatten)]
    /// The edges.
    async fn edges(&self) -> E {
        self.1.clone()
    }

    /// The viewer's frecency score for this entity, when loaded.
    async fn frecency_score(&self) -> Option<f64> {
        self.2
    }
}

/// GraphQL foreign entity.
pub struct GraphqlSoupForeignEntity<E: SoupEntityEdges>(SoupForeignEntity, E, Option<f64>);

/// GraphQL representation of the soup foreign entity.
#[Object(name = "GraphqlSoupForeignEntity")]
impl<E> GraphqlSoupForeignEntity<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    /// Canonical entity kind.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        GraphqlSoupEntityType::ForeignEntity
    }

    /// Foreign entities do not expose a common display name.
    async fn display_name(&self) -> Option<String> {
        None
    }

    /// Common foreign-entity metadata.
    async fn metadata(&self) -> GraphqlEntityMetadata {
        GraphqlEntityMetadata {
            owner_id: None,
            parent: None,
            created_at: Some(self.0.created_at.to_rfc3339()),
            updated_at: Some(self.0.updated_at.to_rfc3339()),
            viewed_at: None,
            deleted_at: None,
        }
    }

    /// The identifier of the foreign entity.
    async fn foreign_entity_id(&self) -> &str {
        &self.0.foreign_entity_id
    }

    /// The foreign entity source.
    async fn foreign_entity_source(&self) -> &str {
        &self.0.foreign_entity_source
    }

    /// The identifier of the stored for.
    async fn stored_for_id(&self) -> &str {
        &self.0.stored_for_id
    }

    /// The stored for auth entity.
    async fn stored_for_auth_entity(&self) -> &str {
        &self.0.stored_for_auth_entity
    }

    /// Source-specific metadata.
    async fn source_metadata(&self) -> Json<Value> {
        Json(self.0.metadata.clone())
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    #[graphql(flatten)]
    /// The edges.
    async fn edges(&self) -> E {
        self.1.clone()
    }

    /// The viewer's frecency score for this entity, when loaded.
    async fn frecency_score(&self) -> Option<f64> {
        self.2
    }
}

/// Implement interface-only dispatch methods for fields whose concrete
/// GraphQL definitions are supplied by the flattened edge object.
macro_rules! impl_common_interface_edges {
    ($($entity:ident),+ $(,)?) => {
        $(
            impl<E: SoupEntityEdges> $entity<E> {
                /// Resolve shared properties through the composed edge adapter.
                async fn interface_properties(
                    &self,
                    ctx: &Context<'_>,
                ) -> async_graphql::Result<Vec<E::Property>> {
                    self.1.resolve_properties(ctx).await
                }

                /// Resolve shared notifications through the composed edge adapter.
                async fn interface_notifications(
                    &self,
                    ctx: &Context<'_>,
                ) -> async_graphql::Result<Vec<E::Notification>> {
                    self.1.resolve_notifications(ctx).await
                }

                /// Resolve shared favorite state through the composed edge adapter.
                async fn interface_is_favorited(
                    &self,
                    ctx: &Context<'_>,
                ) -> async_graphql::Result<bool> {
                    self.1.resolve_is_favorited(ctx).await
                }

                /// Resolve shared viewer permission through the composed edge adapter.
                async fn interface_viewer_permission(
                    &self,
                    ctx: &Context<'_>,
                ) -> async_graphql::Result<Option<GraphqlEntityPermission>> {
                    self.1.resolve_viewer_permission(ctx).await
                }

            }
        )+
    };
}

impl_common_interface_edges!(
    GraphqlSoupDocument,
    GraphqlSoupChat,
    GraphqlSoupProject,
    GraphqlSoupEmailThread,
    GraphqlSoupChannel,
    GraphqlSoupChannelMessage,
    GraphqlSoupCall,
    GraphqlSoupCrmCompany,
    GraphqlSoupForeignEntity,
);
