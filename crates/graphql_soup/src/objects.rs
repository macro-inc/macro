use async_graphql::{ID, Json, Object, ObjectType, Union};
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
use soup::domain::models::FrecencySoupItem;

/// Extension fields attached to every top-level Soup entity.
///
/// The concrete edge object is supplied by the schema composition crate and
/// flattened into each Soup entity's GraphQL fields.
pub trait SoupEntityEdges: ObjectType + Clone + Send + Sync + 'static {
    /// Construct the edge object for a Soup entity.
    fn from_entity(entity: model_entity::Entity<'static>) -> Self;
}

/// Page returned by `Query.soup`.
pub struct SoupPage<E: SoupEntityEdges, PE: SoupEntityEdges> {
    items: Vec<GraphqlSoupItem<E, PE>>,
    next_cursor: Option<String>,
    has_more: bool,
}

/// Page returned by `Query.soup`.
#[Object(name = "SoupPage")]
impl<E, PE> SoupPage<E, PE>
where
    E: SoupEntityEdges,
    PE: SoupEntityEdges,
{
    /// Items in the current page.
    async fn items(&self) -> &[GraphqlSoupItem<E, PE>] {
        &self.items
    }

    /// Opaque cursor for the next page, if one exists.
    async fn next_cursor(&self) -> Option<&str> {
        self.next_cursor.as_deref()
    }

    /// Whether more items are available after this page.
    async fn has_more(&self) -> bool {
        self.has_more
    }
}

impl<E: SoupEntityEdges, PE: SoupEntityEdges> From<PaginatedOpaqueCursor<FrecencySoupItem>>
    for SoupPage<E, PE>
{
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
pub struct GraphqlSoupItem<E: SoupEntityEdges, PE: SoupEntityEdges> {
    id: String,
    entity_type: GraphqlSoupEntityType,
    frecency_score: f64,
    entity: GraphqlSoupEntity<E, PE>,
}

#[Object(name = "GraphqlSoupItem")]
impl<E, PE> GraphqlSoupItem<E, PE>
where
    E: SoupEntityEdges,
    PE: SoupEntityEdges,
{
    async fn id(&self) -> ID {
        ID(self.id.clone())
    }

    async fn entity_type(&self) -> GraphqlSoupEntityType {
        self.entity_type
    }

    async fn frecency_score(&self) -> f64 {
        self.frecency_score
    }

    async fn entity(&self) -> &GraphqlSoupEntity<E, PE> {
        &self.entity
    }
}

impl<E: SoupEntityEdges, PE: SoupEntityEdges> From<FrecencySoupItem> for GraphqlSoupItem<E, PE> {
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
pub enum GraphqlSoupEntity<E: SoupEntityEdges, PE: SoupEntityEdges> {
    /// Document entity.
    Document(GraphqlSoupDocument<PE>),
    /// Chat entity.
    Chat(GraphqlSoupChat<PE>),
    /// Project entity.
    Project(GraphqlSoupProject<PE>),
    /// Email thread entity.
    EmailThread(GraphqlSoupEmailThread<PE>),
    /// Channel entity.
    Channel(GraphqlSoupChannel<E>),
    /// Channel thread entity.
    ChannelThread(GraphqlSoupChannelThread<E>),
    /// Call entity.
    Call(GraphqlSoupCall<E>),
    /// CRM company entity.
    CrmCompany(GraphqlSoupCrmCompany<PE>),
    /// Foreign entity.
    ForeignEntity(GraphqlSoupForeignEntity<E>),
}

impl<E, PE> From<SoupItem> for GraphqlSoupEntity<E, PE>
where
    E: SoupEntityEdges,
    PE: SoupEntityEdges,
{
    fn from(item: SoupItem) -> Self {
        match item {
            SoupItem::Document(item) => {
                let edges = PE::from_entity(
                    model_entity::EntityType::Document.with_entity_string(item.id.to_string()),
                );
                Self::Document(GraphqlSoupDocument(item, edges))
            }
            SoupItem::Chat(item) => {
                let edges = PE::from_entity(
                    model_entity::EntityType::Chat.with_entity_string(item.id.to_string()),
                );
                Self::Chat(GraphqlSoupChat(item, edges))
            }
            SoupItem::Project(item) => {
                let edges = PE::from_entity(
                    model_entity::EntityType::Project.with_entity_string(item.id.to_string()),
                );
                Self::Project(GraphqlSoupProject(item, edges))
            }
            SoupItem::EmailThread(item) => {
                let edges = PE::from_entity(
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
                let edges = PE::from_entity(
                    model_entity::EntityType::CrmCompany.with_entity_string(item.id.to_string()),
                );
                Self::CrmCompany(GraphqlSoupCrmCompany(item, edges))
            }
            SoupItem::ForeignEntity(item) => {
                let edges = E::from_entity(
                    model_entity::EntityType::ForeignEntity
                        .with_entity_string(item.foreign_entity_id.clone()),
                );
                Self::ForeignEntity(GraphqlSoupForeignEntity(item, edges))
            }
        }
    }
}

/// GraphQL document entity.
pub struct GraphqlSoupDocument<E: SoupEntityEdges>(SoupDocument, E);

#[Object(name = "GraphqlSoupDocument")]
impl<E> GraphqlSoupDocument<E>
where
    E: SoupEntityEdges,
{
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

    #[graphql(flatten)]
    async fn edges(&self) -> E {
        self.1.clone()
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

/// GraphQL chat entity.
pub struct GraphqlSoupChat<E: SoupEntityEdges>(SoupChat, E);

#[Object(name = "GraphqlSoupChat")]
impl<E> GraphqlSoupChat<E>
where
    E: SoupEntityEdges,
{
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

    #[graphql(flatten)]
    async fn edges(&self) -> E {
        self.1.clone()
    }
}

/// GraphQL project entity.
pub struct GraphqlSoupProject<E: SoupEntityEdges>(SoupProject, E);

#[Object(name = "GraphqlSoupProject")]
impl<E> GraphqlSoupProject<E>
where
    E: SoupEntityEdges,
{
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

    #[graphql(flatten)]
    async fn edges(&self) -> E {
        self.1.clone()
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
pub struct GraphqlSoupEmailThread<E: SoupEntityEdges>(SoupEnrichedEmailThreadPreview, E);

#[Object(name = "GraphqlSoupEmailThread")]
impl<E> GraphqlSoupEmailThread<E>
where
    E: SoupEntityEdges,
{
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

    #[graphql(flatten)]
    async fn edges(&self) -> E {
        self.1.clone()
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
pub struct GraphqlSoupChannel<E: SoupEntityEdges>(SoupChannel, E);

impl<E: SoupEntityEdges> GraphqlSoupChannel<E> {
    fn channel_type_name(channel_type: ChannelType) -> &'static str {
        match channel_type {
            ChannelType::Public => "public",
            ChannelType::Private => "private",
            ChannelType::DirectMessage => "direct_message",
            ChannelType::Team => "team",
        }
    }
}

#[Object(name = "GraphqlSoupChannel")]
impl<E> GraphqlSoupChannel<E>
where
    E: SoupEntityEdges,
{
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

    #[graphql(flatten)]
    async fn edges(&self) -> E {
        self.1.clone()
    }
}

/// GraphQL channel thread entity.
pub struct GraphqlSoupChannelThread<E: SoupEntityEdges>(SoupChannelThread, E);

#[Object(name = "GraphqlSoupChannelThread")]
impl<E> GraphqlSoupChannelThread<E>
where
    E: SoupEntityEdges,
{
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

    #[graphql(flatten)]
    async fn edges(&self) -> E {
        self.1.clone()
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
pub struct GraphqlSoupCall<E: SoupEntityEdges>(SoupCallRecord, E);

#[Object(name = "GraphqlSoupCall")]
impl<E> GraphqlSoupCall<E>
where
    E: SoupEntityEdges,
{
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

    #[graphql(flatten)]
    async fn edges(&self) -> E {
        self.1.clone()
    }
}

/// GraphQL CRM company entity.
pub struct GraphqlSoupCrmCompany<E: SoupEntityEdges>(SoupCrmCompany, E);

#[Object(name = "GraphqlSoupCrmCompany")]
impl<E> GraphqlSoupCrmCompany<E>
where
    E: SoupEntityEdges,
{
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

    #[graphql(flatten)]
    async fn edges(&self) -> E {
        self.1.clone()
    }
}

/// GraphQL foreign entity.
pub struct GraphqlSoupForeignEntity<E: SoupEntityEdges>(SoupForeignEntity, E);

#[Object(name = "GraphqlSoupForeignEntity")]
impl<E> GraphqlSoupForeignEntity<E>
where
    E: SoupEntityEdges,
{
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

    #[graphql(flatten)]
    async fn edges(&self) -> E {
        self.1.clone()
    }
}
