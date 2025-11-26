use std::{collections::HashMap, fmt::Display};

use models_opensearch::SearchEntityType;

use crate::search::query::Keys;

/// macro open/close tags for highlight matches
#[derive(Debug, PartialEq)]
pub(crate) enum MacroEm {
    /// Open tag <macro_em>
    Open,
    /// Close tag </macro_em>
    Close,
}

impl Display for MacroEm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Open => write!(f, "<macro_em>"),
            Self::Close => write!(f, "</macro_em>"),
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Hit<T> {
    #[serde(rename = "_score")]
    pub score: Option<f64>,
    #[serde(rename = "_source")]
    pub source: T,
    /// Highlights may or may not be present since we could match
    /// purely on the title of the item
    pub highlight: Option<HashMap<String, Vec<String>>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Default, Clone)]
pub struct Highlight {
    /// The highlight name match if present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,

    /// The highlight content matches
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<String>,
}

pub(crate) fn parse_highlight_hit(
    highlight: HashMap<String, Vec<String>>,
    keys: Keys,
) -> Highlight {
    Highlight {
        name: highlight
            .get(keys.title_key)
            .and_then(|v| v.first())
            .map(|v| v.to_string()),
        content: highlight
            .get(keys.content_key)
            .map(|v| v.to_vec())
            .unwrap_or_default(),
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Total {
    pub value: i64,
    pub relation: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Hits<T> {
    pub total: Total,
    pub max_score: Option<f64>,
    pub hits: Vec<Hit<T>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct Shards {
    pub total: i32,
    pub successful: i32,
    pub skipped: i32,
    pub failed: i32,
}

pub(crate) type DefaultSearchResponse<T> = SearchResponse<T>;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(crate) struct SearchResponse<T> {
    pub hits: Hits<T>,
    pub took: i32,
    pub timed_out: bool,
    pub _shards: Shards,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct NameIndex {
    /// The entity id
    pub entity_id: String,
    /// The entity type
    pub entity_type: SearchEntityType,
    /// The name of the entity
    pub name: String,
    /// The creator of the entity
    pub user_id: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct SearchGotoDocument {
    /// The node id of the document.
    /// This is either a 0-indexed page number for pdfs (and docx since they are pdfs)
    /// or a uuid of a lexical node for md. This can be ignored for all other
    /// file types.
    pub node_id: String,
    /// The raw content of the document
    pub raw_content: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct SearchGotoChat {
    /// The chat message id
    pub chat_message_id: String,
    /// The role of the chat message
    pub role: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct SearchGotoEmail {
    /// The email message id
    pub email_message_id: String,
    /// The bcc of the email
    pub bcc: Vec<String>,
    /// The cc of the email
    pub cc: Vec<String>,
    /// The labels of the email
    pub labels: Vec<String>,
    /// The sent_at timestamp of the email
    pub sent_at: Option<i64>,
    /// The sender of the email
    pub sender: String,
    /// The recipients of the email
    pub recipients: Vec<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct SearchGotoChannel {
    /// The channel message id
    pub channel_message_id: String,
    pub thread_id: Option<String>,
    pub sender_id: String,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Enum containing structs for all data needed to handle search "goto" in the frontend
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(untagged)]
pub enum SearchGotoContent {
    Documents(SearchGotoDocument),
    Chats(SearchGotoChat),
    Emails(SearchGotoEmail),
    Channels(SearchGotoChannel),
    // there is no goto needed for projects
}

/// This struct represents a single search hit for a given entity
#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
pub struct SearchHit {
    /// The id of the entity
    pub entity_id: String,
    /// The entity type
    pub entity_type: SearchEntityType,
    /// The score of the match
    pub score: Option<f64>,
    /// The highlight of the match
    pub highlight: Highlight,
    /// The goto content for the entity
    pub goto: Option<SearchGotoContent>,
}
