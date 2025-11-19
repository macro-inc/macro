use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};
use utoipa::ToSchema;

pub mod score;
pub mod channel;
pub mod chat;
pub mod document;
pub mod email;
pub mod project;
pub mod timestamp;
pub mod unified;

pub use timestamp::*;

#[derive(
    Serialize,
    Deserialize,
    Debug,
    ToSchema,
    Copy,
    Clone,
    EnumString,
    Display,
    PartialEq,
    JsonSchema,
    Default,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SearchOn {
    Name,
    #[default]
    Content,
    NameContent,
}

impl From<SearchOn> for opensearch_client::SearchOn {
    fn from(value: SearchOn) -> Self {
        match value {
            SearchOn::Name => opensearch_client::SearchOn::Name,
            SearchOn::Content => opensearch_client::SearchOn::Content,
            SearchOn::NameContent => opensearch_client::SearchOn::NameContent,
        }
    }
}

#[derive(
    Serialize, Deserialize, Debug, ToSchema, Copy, Clone, EnumString, Display, PartialEq, JsonSchema,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum MatchType {
    // Exact match. Matches on full words/phrases.
    Exact,
    // Partial match. Matches on partial words/phrases.
    Partial,
    // Regex match. All terms you provide are treated as regular expressions.
    Regexp,
    #[schemars(skip)]
    // Query match. Matches using the OpenSearch Simple Query String DSL
    Query,
}

/// A generic response item
#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SearchResponseItem<T, S> {
    // TODO: would be nice to pull id out of all the data eventually
    // /// The id of the channel
    // pub id: String,
    /// The name of the response
    pub results: Vec<T>,
    /// Optional metadata for the item
    // flattening should make this struct virtually the same
    #[serde(flatten)]
    pub metadata: S,
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct SearchResponse<T> {
    /// List containing results from a request
    pub results: Vec<T>,
}

pub trait ItemId {
    fn get_id(&self) -> &String;
}

pub trait Metadata<T> {
    fn metadata(&self, id: &str) -> T;
}

#[derive(Debug, Serialize, Deserialize, ToSchema, JsonSchema, Default)]
pub struct SearchHighlight {
    /// The highlight match on the name field
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The highlight match on the content field
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<String>,
}

impl From<opensearch_client::search::model::Highlight> for SearchHighlight {
    fn from(highlight: opensearch_client::search::model::Highlight) -> Self {
        Self {
            name: highlight.name,
            content: highlight.content,
        }
    }
}
