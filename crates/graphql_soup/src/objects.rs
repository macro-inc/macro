use async_graphql::{ID, Json, Object, ObjectType, SimpleObject, Union};
use graphql_common::GraphqlSoupEntityType;
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
    /// Construct the common/global edge object for a Soup entity.
    /// This is for edges that apply to all soup entities, e.g. notifications
    fn from_entity(entity: model_entity::Entity<'static>) -> Self;

    /// Additional fields attached only to email-thread entities.
    type EmailThreadEdges: ObjectType + Clone + Send + Sync + 'static;

    /// Construct the email-thread-specific edge object.
    fn email_thread_edges(email_thread_id: Uuid) -> Self::EmailThreadEdges;
}

/// Page returned by `Query.soup`.
#[derive(SimpleObject)]
pub struct SoupPage<E: SoupEntityEdges> {
    /// Items in the current page.
    items: Vec<GraphqlSoupItem<E>>,
    /// Opaque cursor for the next page, if one exists.
    next_cursor: Option<String>,
    /// Whether more items are available after this page.
    has_more: bool,
}

impl<E: SoupEntityEdges> From<PaginatedOpaqueCursor<SoupItem<()>>> for SoupPage<E> {
    fn from(page: PaginatedOpaqueCursor<SoupItem<()>>) -> Self {
        let has_more = page.next_cursor.is_some();
        Self {
            items: page.items.into_iter().map(GraphqlSoupItem::from).collect(),
            next_cursor: page.next_cursor,
            has_more,
        }
    }
}

impl<E: SoupEntityEdges> From<PaginatedOpaqueCursor<EnrichedSoupItem>> for SoupPage<E> {
    fn from(page: PaginatedOpaqueCursor<EnrichedSoupItem>) -> Self {
        let has_more = page.next_cursor.is_some();
        Self {
            items: page.items.into_iter().map(GraphqlSoupItem::from).collect(),
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
                        .map(|item| GraphqlSoupItem::from(item.map_extra(|_| ())))
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
    items: Vec<GraphqlSoupItem<E>>,
}

/// GraphQL Soup item envelope.
pub struct GraphqlSoupItem<E: SoupEntityEdges> {
    /// The unique identifier.
    id: String,
    /// The entity type.
    entity_type: GraphqlSoupEntityType,
    /// The frecency score.
    frecency_score: f64,
    /// The expanded Soup entity.
    entity: GraphqlSoupEntity<E>,
}

/// GraphQL representation of the soup item.
#[Object(name = "GraphqlSoupItem")]
impl<E> GraphqlSoupItem<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.id.clone())
    }

    /// The entity type.
    async fn entity_type(&self) -> GraphqlSoupEntityType {
        self.entity_type
    }

    /// The frecency score.
    async fn frecency_score(&self) -> f64 {
        self.frecency_score
    }

    /// The expanded Soup entity.
    async fn entity(&self) -> &GraphqlSoupEntity<E> {
        &self.entity
    }
}

impl<E: SoupEntityEdges> From<SoupItem<()>> for GraphqlSoupItem<E> {
    fn from(item: SoupItem<()>) -> Self {
        let entity_ref = item.entity();
        Self {
            id: entity_ref.entity_id.into_owned(),
            entity_type: GraphqlSoupEntityType::from(entity_ref.entity_type),
            frecency_score: 0.0,
            entity: GraphqlSoupEntity::from(item),
        }
    }
}

impl<E: SoupEntityEdges> From<EnrichedSoupItem> for GraphqlSoupItem<E> {
    fn from(item: EnrichedSoupItem) -> Self {
        let EnrichedSoupItem {
            item,
            frecency_score,
            ..
        } = item;
        let item = item.map_extra(|_| ());
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
    /// Channel thread entity.
    ChannelThread(GraphqlSoupChannelThread<E>),
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
                Self::Document(GraphqlSoupDocument(item, edges))
            }
            SoupItem::Chat(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::Chat.with_entity_string(item.id.to_string()),
                );
                Self::Chat(GraphqlSoupChat(item, edges))
            }
            SoupItem::Project(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::Project.with_entity_string(item.id.to_string()),
                );
                Self::Project(GraphqlSoupProject(item, edges))
            }
            SoupItem::EmailThread(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::EmailThread
                        .with_entity_string(item.thread.id.to_string()),
                );
                Self::EmailThread(GraphqlSoupEmailThread(item, edges))
            }
            SoupItem::Channel(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::Channel
                        .with_entity_string(item.channel.channel.id.0.to_string()),
                );
                Self::Channel(GraphqlSoupChannel(item, edges))
            }
            SoupItem::ChannelThread(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::ChannelMessage
                        .with_entity_string(item.id.to_string()),
                );
                Self::ChannelThread(GraphqlSoupChannelThread(item, edges))
            }
            SoupItem::Call(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::Call.with_entity_string(item.call_id.to_string()),
                );
                Self::Call(GraphqlSoupCall(item, edges))
            }
            SoupItem::CrmCompany(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::CrmCompany.with_entity_string(item.id.to_string()),
                );
                Self::CrmCompany(GraphqlSoupCrmCompany(item, edges))
            }
            SoupItem::ForeignEntity(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::ForeignEntity.with_entity_string(item.id.to_string()),
                );
                Self::ForeignEntity(GraphqlSoupForeignEntity(item, edges))
            }
        }
    }
}

/// GraphQL document entity.
pub struct GraphqlSoupDocument<E: SoupEntityEdges>(SoupDocument<()>, E);

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
pub struct GraphqlSoupChat<E: SoupEntityEdges>(SoupChat<()>, E);

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
}

/// GraphQL project entity.
pub struct GraphqlSoupProject<E: SoupEntityEdges>(SoupProject<()>, E);

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
pub struct GraphqlSoupEmailThread<E: SoupEntityEdges>(SoupEnrichedEmailThreadPreview<()>, E);

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

/// GraphQL channel message summary.
pub struct GraphqlSoupChannelMessage(ChannelMessage);

// NOTE: `id` (not `messageId`) — objects exposing `id: ID!` are treated as
// normalized entities by clients' caches (presence-of-id convention).

/// GraphQL representation of the soup channel message.
#[Object]
impl GraphqlSoupChannelMessage {
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.message_id.to_string())
    }

    /// The identifier of the thread.
    async fn thread_id(&self) -> Option<ID> {
        self.0.thread_id.map(|id| ID(id.to_string()))
    }

    /// The identifier of the sender.
    async fn sender_id(&self) -> &str {
        &self.0.sender_id
    }

    /// The content.
    async fn content(&self) -> &str {
        &self.0.content
    }

    /// The created timestamp in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// The updated timestamp in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    /// The deleted timestamp in RFC 3339 format.
    async fn deleted_at(&self) -> Option<String> {
        self.0.deleted_at.map(|ts| ts.to_rfc3339())
    }

    /// The mentions.
    async fn mentions(&self) -> &[String] {
        &self.0.mentions
    }
}

/// GraphQL channel entity.
pub struct GraphqlSoupChannel<E: SoupEntityEdges>(SoupChannel, E);

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
    async fn latest_message(&self) -> Option<GraphqlSoupChannelMessage> {
        self.0
            .latest_message
            .latest_message
            .clone()
            .map(GraphqlSoupChannelMessage)
    }

    /// The latest non thread message.
    async fn latest_non_thread_message(&self) -> Option<GraphqlSoupChannelMessage> {
        self.0
            .latest_message
            .latest_non_thread_message
            .clone()
            .map(GraphqlSoupChannelMessage)
    }

    #[graphql(flatten)]
    /// The edges.
    async fn edges(&self) -> E {
        self.1.clone()
    }
}

/// GraphQL channel thread entity.
pub struct GraphqlSoupChannelThread<E: SoupEntityEdges>(SoupChannelThread, E);

/// GraphQL representation of the soup channel thread.
#[Object(name = "GraphqlSoupChannelThread")]
impl<E> GraphqlSoupChannelThread<E>
where
    E: SoupEntityEdges,
{
    /// The unique identifier.
    async fn id(&self) -> ID {
        ID(self.0.id.to_string())
    }

    /// The identifier of the channel.
    async fn channel_id(&self) -> ID {
        ID(self.0.channel_id.to_string())
    }

    /// The identifier of the sender.
    async fn sender_id(&self) -> &str {
        &self.0.sender_id
    }

    /// The content.
    async fn content(&self) -> &str {
        &self.0.content
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
pub struct GraphqlSoupCall<E: SoupEntityEdges>(SoupCallRecord<()>, E);

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
}

/// GraphQL CRM company entity.
pub struct GraphqlSoupCrmCompany<E: SoupEntityEdges>(SoupCrmCompany<()>, E);

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
}

/// GraphQL foreign entity.
pub struct GraphqlSoupForeignEntity<E: SoupEntityEdges>(SoupForeignEntity, E);

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

    /// The metadata.
    async fn metadata(&self) -> Json<Value> {
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
}
