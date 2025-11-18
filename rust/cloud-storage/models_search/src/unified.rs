use crate::channel::ChannelSearchResponseItemWithMetadata;
use crate::chat::ChatSearchResponseItemWithMetadata;
use crate::document::DocumentSearchResponseItemWithMetadata;
use crate::email::EmailSearchResponseItemWithMetadata;
use crate::project::ProjectSearchResponseItemWithMetadata;
use crate::{
    MatchType, SearchOn, channel::SimpleChannelSearchReponseBaseItem,
    chat::SimpleChatSearchResponseBaseItem, document::SimpleDocumentSearchResponseBaseItem,
    email::SimpleEmailSearchResponseBaseItem, project::SimpleProjectSearchResponseBaseItem,
};
use item_filters::{ChannelFilters, ChatFilters, DocumentFilters, EmailFilters, ProjectFilters};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema, JsonSchema, Eq, PartialEq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum UnifiedSearchIndex {
    Documents,
    Chats,
    Emails,
    Channels,
    Projects,
}

// TODO: query, terms, match_type are common to all requests. consolidate.
#[derive(Debug, Serialize, Deserialize, ToSchema, Clone, JsonSchema)]
pub struct UnifiedSearchRequest {
    #[schemars(skip)]
    pub query: Option<String>,

    /// Multiple distinct search terms as separate strings. Use this for keyword-based searches where you want to find content containing any of these terms. Each term must be at least 3 characters (shorter terms are automatically filtered out). Examples: ['machine', 'learning', 'algorithms'], ['project', 'status', 'update']. `null` this field if searching without text terms to search all. This field matches query string against both name and content.
    pub terms: Option<Vec<String>>,

    /// How to match the search terms. 'exact' for precise case-sensitive phrase matches, 'partial' for prefix/partial matches. REQUIRED field.
    pub match_type: MatchType,

    /// If search_on is set to NameContent, you can disable the recency filter
    /// by setting to true.
    #[serde(default)]
    #[schemars(skip)]
    pub disable_recency: bool,

    /// Search filters for various kinds of items. Set the entire filters property as `null` if you do not have specific filters for a given type, e.g. bcc for email filters.
    pub filters: Option<UnifiedSearchFilters>,

    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    #[serde(default)]
    pub search_on: SearchOn,

    #[schemars(skip)]
    pub collapse: Option<bool>,

    /// Include specific entity types from search. If empty, all entity types will be searched over. If you are unsure which types to search, use an empty array to search all.
    #[serde(default)]
    pub include: Vec<UnifiedSearchIndex>,
}

// TODO: there's a data correlation between Filters and Response Item. Can this be consolidated?
// None means do not search this entity, Some(_::default()) means search all for this entity
#[derive(Debug, Serialize, Deserialize, ToSchema, Clone, JsonSchema)]
pub struct UnifiedSearchFilters {
    /// Document filters. `null` to not filter documents searched over.
    pub document: Option<DocumentFilters>,
    /// Chat filters. `null` to not filter chats searched over.
    pub chat: Option<ChatFilters>,
    /// Email filters. `null` to not filter emails searched over.
    pub email: Option<EmailFilters>,
    /// Channel filters. `null` to not filter channels searched over.
    pub channel: Option<ChannelFilters>,
    /// Project filters. `null` to not filter projects searched over.
    pub project: Option<ProjectFilters>,
}

impl Default for UnifiedSearchFilters {
    fn default() -> Self {
        Self {
            document: Some(DocumentFilters::default()),
            chat: Some(ChatFilters::default()),
            email: Some(EmailFilters::default()),
            channel: Some(ChannelFilters::default()),
            project: Some(ProjectFilters::default()),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum UnifiedSearchResponseItem {
    Document(DocumentSearchResponseItemWithMetadata),
    Chat(ChatSearchResponseItemWithMetadata),
    Email(EmailSearchResponseItemWithMetadata),
    Channel(ChannelSearchResponseItemWithMetadata),
    Project(ProjectSearchResponseItemWithMetadata),
}

#[derive(Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct UnifiedSearchResponse {
    pub results: Vec<UnifiedSearchResponseItem>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum SimpleUnifiedSearchResponseBaseItem<T> {
    Document(SimpleDocumentSearchResponseBaseItem<T>),
    Chat(SimpleChatSearchResponseBaseItem<T>),
    Email(SimpleEmailSearchResponseBaseItem<T>),
    Channel(SimpleChannelSearchReponseBaseItem<T>),
    Project(SimpleProjectSearchResponseBaseItem<T>),
}

pub type SimpleUnifiedSearchResponseItem =
    SimpleUnifiedSearchResponseBaseItem<crate::TimestampSeconds>;

impl From<opensearch_client::search::unified::UnifiedSearchResponse>
    for SimpleUnifiedSearchResponseItem
{
    fn from(response: opensearch_client::search::unified::UnifiedSearchResponse) -> Self {
        match response {
            opensearch_client::search::unified::UnifiedSearchResponse::Document(a) => {
                SimpleUnifiedSearchResponseItem::Document(SimpleDocumentSearchResponseBaseItem {
                    document_id: a.document_id,
                    document_name: a.document_name,
                    node_id: a.node_id,
                    owner_id: a.owner_id,
                    file_type: a.file_type,
                    updated_at: a.updated_at.into(),
                    highlight: a.highlight.into(),
                    raw_content: a.raw_content,
                })
            }
            opensearch_client::search::unified::UnifiedSearchResponse::Chat(a) => {
                SimpleUnifiedSearchResponseItem::Chat(SimpleChatSearchResponseBaseItem {
                    chat_id: a.chat_id,
                    chat_message_id: a.chat_message_id,
                    user_id: a.user_id,
                    role: a.role,
                    title: a.title,
                    highlight: a.highlight.into(),
                    updated_at: a.updated_at.into(),
                })
            }
            opensearch_client::search::unified::UnifiedSearchResponse::Email(a) => {
                SimpleUnifiedSearchResponseItem::Email(SimpleEmailSearchResponseBaseItem {
                    thread_id: a.thread_id,
                    message_id: a.message_id,
                    subject: a.subject,
                    sender: a.sender,
                    recipients: a.recipients,
                    cc: a.cc,
                    bcc: a.bcc,
                    labels: a.labels,
                    link_id: a.link_id,
                    user_id: a.user_id,
                    updated_at: a.updated_at.into(),
                    sent_at: a.sent_at.map(|a| a.into()),
                    highlight: a.highlight.into(),
                })
            }
            opensearch_client::search::unified::UnifiedSearchResponse::ChannelMessage(a) => {
                SimpleUnifiedSearchResponseItem::Channel(SimpleChannelSearchReponseBaseItem {
                    channel_id: a.channel_id,
                    channel_name: a.channel_name,
                    channel_type: a.channel_type,
                    org_id: a.org_id,
                    message_id: a.message_id,
                    thread_id: a.thread_id,
                    sender_id: a.sender_id,
                    mentions: a.mentions,
                    created_at: a.created_at.into(),
                    updated_at: a.updated_at.into(),
                    highlight: a.highlight.into(),
                })
            }
            opensearch_client::search::unified::UnifiedSearchResponse::Project(a) => {
                SimpleUnifiedSearchResponseItem::Project(SimpleProjectSearchResponseBaseItem {
                    project_id: a.project_id,
                    project_name: a.project_name,
                    user_id: a.user_id,
                    created_at: a.created_at.into(),
                    updated_at: a.updated_at.into(),
                    highlight: a.highlight.into(),
                })
            }
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct SimpleUnifiedSearchBaseResponse<T> {
    pub results: Vec<SimpleUnifiedSearchResponseBaseItem<T>>,
}

pub type SimpleUnifiedSearchResponse = SimpleUnifiedSearchBaseResponse<crate::TimestampSeconds>;
