use crate::{MatchType, SearchHighlight, SearchOn, SearchResponseItem};
use item_filters::EmailFilters;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A email message match for a given thread id
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchResult {
    /// The email message id.
    pub message_id: String,
    pub subject: Option<String>,
    pub sender: String,
    pub recipients: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub labels: Vec<String>,
    /// The highlights for the email message
    pub highlight: SearchHighlight,
    /// When the search email message was last updated
    pub updated_at: i64,
    /// When the email message was sent
    pub sent_at: Option<i64>,
}

/// A single response item, part of the EmailSearchResponse object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchResponseItem {
    /// Standardized fields that all item types will share.
    /// These field names are being aligned across all item types
    /// for consistency in our data model.
    pub id: String,
    /// email threads don't have names, but keeping this here for consistency with other search items
    pub name: Option<String>,
    pub owner_id: String,

    /// The id of the email thread
    pub thread_id: String,
    /// The id of the owner of the email thread
    pub user_id: String,
    /// The search results for the document
    /// This may be empty if the search result match was on the email subject only
    pub email_message_search_results: Vec<EmailSearchResult>,
}

/// EmailSearchResponseItem object with email metadata we fetch from email service. we don't store these
/// timestamps in opensearch as they would require us to update each email message record for the thread
/// every time the thread updates (specifically for updated_at and viewed_at)
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchResponseItemWithMetadata {
    pub created_at: i64,
    pub updated_at: i64,
    pub viewed_at: Option<i64>,
    #[serde(flatten)]
    pub extra: EmailSearchResponseItem,
}

/// Metadata associated with Email Search
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchMetadata {
    /// The id of the email thread
    pub thread_id: String,
    /// The id of the owner of the email thread
    pub user_id: String,
}

impl From<SearchResponseItem<EmailSearchResult, EmailSearchMetadata>> for EmailSearchResponseItem {
    fn from(response: SearchResponseItem<EmailSearchResult, EmailSearchMetadata>) -> Self {
        EmailSearchResponseItem {
            id: response.metadata.thread_id.clone(),
            owner_id: response.metadata.user_id.clone(),
            name: None,
            thread_id: response.metadata.thread_id.clone(),
            user_id: response.metadata.user_id.clone(),
            email_message_search_results: response.results,
        }
    }
}

/// The document search response object
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchResponse {
    /// List containing results from email threads
    pub results: Vec<EmailSearchResponseItemWithMetadata>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, JsonSchema)]
pub struct EmailSearchRequest {
    /// The query to search for
    pub query: Option<String>,
    /// Multiple terms to search over
    pub terms: Option<Vec<String>>,
    /// The match type to use when searching
    pub match_type: MatchType,
    /// Search filters for email
    #[serde(flatten)]
    pub filters: Option<EmailFilters>,
    /// Fields to search on (Name, Content, NameContent). Defaults to Content
    #[serde(default)]
    pub search_on: SearchOn,
    /// If true, returns only 1 result per entity. False by default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collapse: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SimpleEmailSearchResponseBaseItem<T> {
    /// The thread id
    pub thread_id: String,
    /// The message id
    pub message_id: String,
    /// The sender
    pub sender: String,
    /// The recipients
    pub recipients: Vec<String>,
    /// The cc
    pub cc: Vec<String>,
    /// The bcc
    pub bcc: Vec<String>,
    /// The labels
    pub labels: Vec<String>,
    /// The link id
    pub link_id: String,
    /// The user id
    pub user_id: String,
    #[schema(inline)]
    /// The time the email was last updated
    pub updated_at: T,
    #[schema(inline)]
    /// The time the email was sent
    pub sent_at: Option<T>,
    /// The subject
    pub subject: Option<String>,
    /// The highlights on the email
    pub highlight: SearchHighlight,
}

pub type SimpleEmailSearchResponseItem = SimpleEmailSearchResponseBaseItem<crate::TimestampSeconds>;

impl From<opensearch_client::search::emails::EmailSearchResponse>
    for SimpleEmailSearchResponseItem
{
    fn from(response: opensearch_client::search::emails::EmailSearchResponse) -> Self {
        Self {
            thread_id: response.thread_id,
            message_id: response.message_id,
            sender: response.sender,
            recipients: response.recipients,
            cc: response.cc,
            bcc: response.bcc,
            labels: response.labels,
            link_id: response.link_id,
            user_id: response.user_id,
            updated_at: response.updated_at.into(),
            sent_at: response.sent_at.map(|t| t.into()),
            subject: response.subject,
            highlight: response.highlight.into(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleEmailSearchResponse {
    /// List containing results from emails.
    /// Each item in the list is for a specific message in an email thread.
    pub results: Vec<SimpleEmailSearchResponseItem>,
}

#[cfg(test)]
mod test;
