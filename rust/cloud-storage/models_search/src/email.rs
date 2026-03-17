use crate::{MatchType, SearchHighlight, SearchOn};
use chrono::{DateTime, Utc};
use item_filters::EmailFilters;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A email message match for a given thread id
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct EmailSearchResult {
    /// The email message id.
    /// This is only present if the search result is on the message content
    pub message_id: Option<uuid::Uuid>,
    /// The sender.
    /// If the match is on the subject, the sender is the latest sender on the thread.
    pub sender: String,
    /// The pretty sender.
    /// If the match is on the subject, the pretty sender is the latest sender on the thread.
    /// This could be the sender's email if there is no contact name for the sender.
    pub pretty_sender: String,
    /// This is only present if the search result is on the message content
    pub recipients: Vec<String>,
    /// This is only present if the search result is on the message content
    pub cc: Vec<String>,
    /// This is only present if the search result is on the message content
    pub bcc: Vec<String>,
    /// This is only present if the search result is on the message content
    pub labels: Vec<String>,
    /// When the email message was sent
    /// This is only present if the search result is on the message content
    pub sent_at: Option<DateTime<Utc>>,
    /// The highlights for the email message
    pub highlight: SearchHighlight,
    /// The score of the result
    #[serde(skip_serializing_if = "Option::is_none")]
    pub score: Option<f64>,
}

/// A participant (sender) in an email thread
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema, Clone)]
pub struct EmailSearchParticipant {
    pub email: String,
    pub name: Option<String>,
}

/// A single response item, part of the EmailSearchResponse object
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct EmailSearchResponseItem {
    /// Standardized fields that all item types will share.
    /// These field names are being aligned across all item types
    /// for consistency in our data model.
    pub id: uuid::Uuid,
    /// Subject of the email thread
    pub name: Option<String>,
    pub owner_id: String,

    /// The subject of the email
    /// This is only present if the search result is on the message content
    pub subject: Option<String>,

    /// The id of the email thread
    pub thread_id: uuid::Uuid,
    /// The id of the owner of the email thread
    pub user_id: String,
    /// The search results for the document
    /// This may be empty if the search result match was on the email subject only
    pub email_message_search_results: Vec<EmailSearchResult>,
    /// The participants (senders) in this email thread
    pub participants: Vec<EmailSearchParticipant>,
}

/// EmailSearchResponseItem object with email metadata we fetch from email service. we don't store these
/// timestamps in opensearch as they would require us to update each email message record for the thread
/// every time the thread updates (specifically for updated_at and viewed_at)
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct EmailSearchResponseItemWithMetadata {
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub viewed_at: Option<DateTime<Utc>>,
    pub snippet: Option<String>,
    pub is_read: bool,
    pub inbox_visible: bool,
    pub is_draft: bool,
    pub is_important: bool,
    #[serde(flatten)]
    pub extra: EmailSearchResponseItem,
}

/// Metadata associated with Email Search
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct EmailSearchMetadata {
    /// The id of the email thread
    pub thread_id: uuid::Uuid,
    /// The id of the owner of the email thread
    pub user_id: String,
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

pub type SimpleEmailSearchResponseItem =
    SimpleEmailSearchResponseBaseItem<crate::HumanReadableTimestamp>;

#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SimpleEmailSearchResponse {
    /// List containing results from emails.
    /// Each item in the list is for a specific message in an email thread.
    pub results: Vec<SimpleEmailSearchResponseItem>,
}

#[cfg(test)]
mod test;
