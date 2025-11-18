use item_filters::ChatFilters;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{MatchType, SearchHighlight, SearchOn, SearchResponseItem};

/// A chat match for a given message id
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatMessageSearchResult {
    /// The chat message id for the chat
    pub chat_message_id: String,
    /// The role of the chat message
    pub role: String,
    /// The highlights for the chat message
    pub highlight: SearchHighlight,
    /// When the search chat was last updated
    pub updated_at: i64,
    /// The title of the chat
    pub title: String,
}

/// A single response item, part of the ChatSearchResponse object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatSearchResponseItem {
    /// Standardized fields that all item types will share.
    /// These field names are being aligned across all item types
    /// for consistency in our data model.
    pub id: String,
    pub name: String,
    pub owner_id: String,

    /// The id of the chat
    pub chat_id: String,
    /// The id of the creator of the chat
    pub user_id: String,
    /// The search results for the chat
    /// This may be empty if the search result match was on the chat title only
    pub chat_search_results: Vec<ChatMessageSearchResult>,
}

/// ChatSearchResponse object with channel metadata we fetch from macrodb. we don't store these
/// timestamps in opensearch as they would require us to update each chat message record for the chat
/// every time the chat updates (specifically for updated_at and viewed_at)
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatSearchResponseItemWithMetadata {
    pub created_at: i64,
    pub updated_at: i64,
    pub viewed_at: Option<i64>,
    pub project_id: Option<String>,
    #[serde(flatten)]
    pub extra: ChatSearchResponseItem,
}

/// The chat search response object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatSearchResponse {
    /// List containing results from chats
    pub results: Vec<ChatSearchResponseItemWithMetadata>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct ChatSearchRequest {
    /// The query to search for
    pub query: Option<String>,
    /// Multiple terms to search over
    pub terms: Option<Vec<String>>,
    /// The match type to use when searching
    pub match_type: MatchType,
    /// If search_on is set to NameContent, you can disable the recency filter
    /// by setting to true.
    #[serde(default)]
    pub disable_recency: bool,
    /// Search filters for chat
    #[serde(flatten)]
    pub filters: Option<ChatFilters>,
    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    #[serde(default)]
    pub search_on: SearchOn,
    /// If true, returns only 1 result per entity. False by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapse: Option<bool>,
}

/// Metadata associated with Chat Search, to be used with SearchResponseItem
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChatSearchMetadata {
    /// The id of the chat
    pub chat_id: String,
    /// The id of the creator of the chat
    pub user_id: String,
    /// The name of the chat
    pub title: String,
}

impl From<SearchResponseItem<ChatMessageSearchResult, ChatSearchMetadata>>
    for ChatSearchResponseItem
{
    fn from(response: SearchResponseItem<ChatMessageSearchResult, ChatSearchMetadata>) -> Self {
        ChatSearchResponseItem {
            id: response.metadata.chat_id.clone(),
            name: response.metadata.title.clone(),
            owner_id: response.metadata.user_id.clone(),
            chat_id: response.metadata.chat_id.clone(),
            user_id: response.metadata.user_id.clone(),
            chat_search_results: response.results,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SimpleChatSearchResponseBaseItem<T> {
    /// The chat id
    pub chat_id: String,
    /// The chat message id
    pub chat_message_id: String,
    /// The user id
    pub user_id: String,
    /// The role
    pub role: String,
    #[schema(inline)]
    /// The time the chat was last updated
    pub updated_at: T,
    /// The title
    pub title: String,
    /// The highlights on the chat
    pub highlight: SearchHighlight,
}

pub type SimpleChatSearchResponseItem = SimpleChatSearchResponseBaseItem<crate::TimestampSeconds>;

impl From<opensearch_client::search::chats::ChatSearchResponse> for SimpleChatSearchResponseItem {
    fn from(response: opensearch_client::search::chats::ChatSearchResponse) -> Self {
        Self {
            chat_id: response.chat_id,
            chat_message_id: response.chat_message_id,
            user_id: response.user_id,
            role: response.role,
            updated_at: response.updated_at.into(),
            title: response.title,
            highlight: response.highlight.into(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleChatSearchResponse {
    /// List containing results from chats.
    /// Each item in the list is for a specific message in a chat.
    pub results: Vec<SimpleChatSearchResponseItem>,
}

#[cfg(test)]
mod test;
