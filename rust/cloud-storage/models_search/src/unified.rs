use chrono::{DateTime, Utc};
use uuid::Uuid;

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
use item_filters::{
    ChannelFilters, ChatFilters, DocumentFilters, EmailFilters, EntityFilters, ProjectFilters,
    ast::document::resolve_file_types,
};
use model_file_type::FileAssociation;
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

const NIL_UUID: &str = "00000000-0000-0000-0000-000000000000";

/// Build an [EntityFilters] from a list of [UnifiedSearchIndex] to include.
/// Entity types not in the list are excluded via NIL UUID.
/// If the list is empty, all entity types are included.
pub fn entity_filters_from_include(
    include: Vec<UnifiedSearchIndex>,
    base: EntityFilters,
) -> EntityFilters {
    if include.is_empty() {
        return base;
    }
    let exclude = vec![NIL_UUID.to_string()];
    let mut filters = base;
    if !include.contains(&UnifiedSearchIndex::Documents) {
        filters.document_filters.document_ids = exclude.clone();
    }
    if !include.contains(&UnifiedSearchIndex::Chats) {
        filters.chat_filters.chat_ids = exclude.clone();
    }
    if !include.contains(&UnifiedSearchIndex::Emails) {
        filters.email_filters.email_thread_ids = exclude.clone();
    }
    if !include.contains(&UnifiedSearchIndex::Channels) {
        filters.channel_filters.channel_ids = exclude.clone();
    }
    if !include.contains(&UnifiedSearchIndex::Projects) {
        filters.project_filters.project_ids = exclude;
    }
    filters
}

// TODO: query, match_type are common to all requests. consolidate.
#[derive(Debug, Serialize, Deserialize, ToSchema, Clone, JsonSchema)]
pub struct UnifiedSearchRequest {
    /// The search query string. Must be at least 3 characters.
    pub query: String,

    /// How to match the search terms. 'exact' for precise case-sensitive phrase matches, 'partial' for prefix/partial matches. REQUIRED field.
    pub match_type: MatchType,

    /// Entity filters in the same shape as soup. Entity types with a NIL UUID in their primary ID field are excluded from search.
    #[serde(default)]
    pub filters: EntityFilters,

    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    #[serde(default)]
    pub search_on: SearchOn,

    #[schemars(skip)]
    pub collapse: Option<bool>,
}

/// Whether a [FileAssociation] is indexed by the search processing service.
pub fn is_searchable_association(assoc: &FileAssociation) -> bool {
    matches!(
        assoc,
        FileAssociation::Pdf(_)
            | FileAssociation::Write(_)
            | FileAssociation::Code(_)
            | FileAssociation::Canvas(_)
            | FileAssociation::Md(_)
    )
}

/// Converted entity filters for the search service.
/// Determines which entity types to include based on NIL UUID exclusion
/// and expands file association prefixes (e.g. `assoc:code`) to concrete extensions.
#[derive(Debug, Clone)]
pub struct SearchEntityFilters {
    /// Whether to include documents in search results
    pub should_include_documents: bool,
    /// Whether to include chats in search results
    pub should_include_chats: bool,
    /// Whether to include emails in search results
    pub should_include_emails: bool,
    /// Whether to include channels in search results
    pub should_include_channels: bool,
    /// Whether to include projects in search results
    pub should_include_projects: bool,
    /// Document filters with file associations expanded
    pub document_filters: DocumentFilters,
    /// Chat filters
    pub chat_filters: ChatFilters,
    /// Email filters
    pub email_filters: EmailFilters,
    /// Channel filters
    pub channel_filters: ChannelFilters,
    /// Project filters
    pub project_filters: ProjectFilters,
}

fn contains_nil_uuid(ids: &[String]) -> bool {
    ids.iter().any(|id| id == NIL_UUID)
}

fn strip_nil_uuids(ids: &mut Vec<String>) {
    ids.retain(|id| id != NIL_UUID);
}

/// Resolve file type strings to concrete extensions for search, dropping
/// non-searchable types. Handles both plain extensions (`"md"`) and `assoc:*`
/// prefixes (`"assoc:code"`).
fn expand_file_types_for_search(file_types: Vec<String>) -> Vec<String> {
    file_types
        .iter()
        .flat_map(|ft| resolve_file_types(ft))
        .filter(|ty| is_searchable_association(&ty.macro_app_path()))
        .map(|ty| ty.as_str().to_string())
        .collect()
}

impl From<EntityFilters> for SearchEntityFilters {
    fn from(filters: EntityFilters) -> Self {
        let mut document_filters = filters.document_filters;
        let mut chat_filters = filters.chat_filters;
        let mut email_filters = filters.email_filters;
        let mut channel_filters = filters.channel_filters;
        let mut project_filters = filters.project_filters;

        let should_include_documents = !contains_nil_uuid(&document_filters.document_ids);
        let should_include_chats = !contains_nil_uuid(&chat_filters.chat_ids);
        let should_include_emails = !contains_nil_uuid(&email_filters.email_thread_ids);
        let should_include_channels = !contains_nil_uuid(&channel_filters.channel_ids);
        let should_include_projects = !contains_nil_uuid(&project_filters.project_ids);

        strip_nil_uuids(&mut document_filters.document_ids);
        strip_nil_uuids(&mut chat_filters.chat_ids);
        strip_nil_uuids(&mut email_filters.email_thread_ids);
        strip_nil_uuids(&mut email_filters.recipients);
        strip_nil_uuids(&mut channel_filters.channel_ids);
        strip_nil_uuids(&mut project_filters.project_ids);

        document_filters.file_types = expand_file_types_for_search(document_filters.file_types);

        Self {
            should_include_documents,
            should_include_chats,
            should_include_emails,
            should_include_channels,
            should_include_projects,
            document_filters,
            chat_filters,
            email_filters,
            channel_filters,
            project_filters,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
#[serde(rename_all = "camelCase", tag = "type")]
pub enum UnifiedSearchResponseItem {
    Document(DocumentSearchResponseItemWithMetadata),
    Chat(ChatSearchResponseItemWithMetadata),
    Email(EmailSearchResponseItemWithMetadata),
    Channel(ChannelSearchResponseItemWithMetadata),
    Project(ProjectSearchResponseItemWithMetadata),
}

impl UnifiedSearchResponseItem {
    pub fn entity_id(&self) -> Uuid {
        match self {
            Self::Document(item) => item.extra.id,
            Self::Chat(item) => item.extra.id,
            Self::Email(item) => item.extra.id,
            Self::Channel(item) => item.extra.id,
            Self::Project(item) => item.extra.id,
        }
    }
    /// Get the updated_at timestamp for each item
    pub fn updated_at(&self) -> Option<DateTime<Utc>> {
        match self {
            Self::Document(item) => item.metadata.as_ref().map(|m| m.updated_at),
            Self::Chat(item) => item.metadata.as_ref().map(|m| m.updated_at),
            Self::Email(item) => Some(item.updated_at),
            Self::Channel(item) => {
                // Get the max updated_at from channel_message_search_results
                let max_result_updated_at = item
                    .extra
                    .channel_message_search_results
                    .iter()
                    .filter_map(|r| r.updated_at)
                    .max();

                // Use max from results, or fall back to metadata.updated_at
                max_result_updated_at.or_else(|| item.metadata.as_ref().map(|m| m.updated_at))
            }
            Self::Project(item) => item.metadata.as_ref().map(|m| m.updated_at),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct UnifiedSearchResponse {
    /// The search results
    pub results: Vec<UnifiedSearchResponseItem>,
    /// The next cursor to use for paginating results
    pub next_cursor: Option<String>,
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
    SimpleUnifiedSearchResponseBaseItem<crate::HumanReadableTimestamp>;

#[derive(Debug, Serialize, Deserialize, ToSchema, Default)]
pub struct SimpleUnifiedSearchBaseResponse<T> {
    pub results: Vec<SimpleUnifiedSearchResponseBaseItem<T>>,
}

pub type SimpleUnifiedSearchResponse =
    SimpleUnifiedSearchBaseResponse<crate::HumanReadableTimestamp>;
