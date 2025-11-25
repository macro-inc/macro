use crate::{MatchType, SearchHighlight, SearchOn, SearchResponseItem};
use item_filters::ChannelFilters;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A channel message match for a given channel id
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChannelSearchResult {
    /// The channel message id
    pub message_id: String,
    /// The channel message thread id
    pub thread_id: Option<String>,
    /// The sender id
    pub sender_id: String,
    /// The highlights for the channel message
    pub highlight: SearchHighlight,
    /// When the channel message was created
    pub created_at: i64,
    /// When the channel message was last updated
    pub updated_at: i64,
    /// The score of the result
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

/// A single response item, part of the ChannelSearchResponse object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChannelSearchResponseItem {
    /// Standardized fields that all item types will share.
    /// These field names are being aligned across all item types
    /// for consistency in our data model.
    pub id: String,
    /// we don't store this for channels atm but keeping it here for consistency
    pub owner_id: Option<String>,

    /// The type of channel
    pub channel_type: String,
    /// The id of the channel
    pub channel_id: String,
    /// The search results for the channel
    /// This may be empty if the search result match was not on content
    pub channel_message_search_results: Vec<ChannelSearchResult>,
}

/// Metadata for a channel fetched from the database
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChannelMetadata {
    pub created_at: i64,
    pub updated_at: i64,
    pub viewed_at: Option<i64>,
    pub interacted_at: Option<i64>,
}

/// ChannelSearchResponseItem object with channel metadata we fetch from macrodb. we don't store these
/// timestamps in opensearch as they would require us to update each chat message record for the chat
/// every time the chat updates (specifically for updated_at and viewed_at and interacted_at)
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChannelSearchResponseItemWithMetadata {
    /// Metadata from the database. None if the channel doesn't exist in the database.
    pub metadata: Option<ChannelMetadata>,
    #[serde(flatten)]
    pub extra: ChannelSearchResponseItem,
}

/// Metadata associated with Channel Search
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChannelSearchMetadata {
    /// The id of the channel
    pub channel_id: String,
    /// The type of channel
    pub channel_type: String,
}

impl From<SearchResponseItem<ChannelSearchResult, ChannelSearchMetadata>>
    for ChannelSearchResponseItem
{
    fn from(response: SearchResponseItem<ChannelSearchResult, ChannelSearchMetadata>) -> Self {
        ChannelSearchResponseItem {
            id: response.metadata.channel_id.clone(),
            // we don't store this for channels atm but keeping it here for consistency
            owner_id: None,
            channel_type: response.metadata.channel_type.clone(),
            channel_id: response.metadata.channel_id.clone(),
            channel_message_search_results: response.results,
        }
    }
}

/// The document search response object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct ChannelSearchResponse {
    /// List containing results from email threads
    pub results: Vec<ChannelSearchResponseItemWithMetadata>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, JsonSchema)]
pub struct ChannelSearchRequest {
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
    /// Search filters for channels
    #[serde(flatten)]
    pub filters: Option<ChannelFilters>,
    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    #[serde(default)]
    pub search_on: SearchOn,
    /// If true, returns only 1 result per entity. False by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapse: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SimpleChannelSearchReponseBaseItem<T> {
    /// The channel id
    pub channel_id: String,
    /// The channel type
    pub channel_type: String,
    /// The org id
    pub org_id: Option<i64>,
    /// The message id
    pub message_id: String,
    /// The thread id
    pub thread_id: Option<String>,
    /// The sender id
    pub sender_id: String,
    /// The mentions
    pub mentions: Vec<String>,
    #[schema(inline)]
    /// The time the channel message was created
    pub created_at: T,
    #[schema(inline)]
    /// The time the channel message was last updated
    pub updated_at: T,
    /// The highlights on the channel message
    pub highlight: SearchHighlight,
}

pub type SimpleChannelSearchReponseItem =
    SimpleChannelSearchReponseBaseItem<crate::TimestampSeconds>;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleChannelSearchResponse {
    /// List containing results from channels.
    /// Each item in the list is for a specific message in a channel.
    pub results: Vec<SimpleChannelSearchReponseItem>,
}

#[cfg(test)]
mod test;
