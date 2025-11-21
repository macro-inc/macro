#![deny(missing_docs)]
//! This crate contains models used by opensearch.
//! This crate should never contain utoipa or any service-level models.
//! This is purely a crate containing models used for opensearch directly.

/// Enum for all the search indices
#[derive(Debug, Clone, Hash, Eq, PartialEq, strum::Display, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "lowercase")]
pub enum SearchIndex {
    /// The channel index
    Channels,
    /// The chat index
    Chats,
    /// The document index
    Documents,
    /// The email index
    Emails,
    /// The project index
    Projects,
    /// The name index
    Names,
}

/// Enum for all entity search indices
#[derive(
    Debug,
    Clone,
    Hash,
    Eq,
    PartialEq,
    strum::Display,
    strum::EnumString,
    strum::AsRefStr,
    serde::Serialize,
    serde::Deserialize,
)]
#[strum(serialize_all = "lowercase")]
#[serde(rename_all = "lowercase")]
pub enum SearchEntityType {
    /// The channel index
    Channels,
    /// The chat index
    Chats,
    /// The document index
    Documents,
    /// The email index
    Emails,
    /// The project index
    Projects,
}

impl From<SearchEntityType> for SearchIndex {
    fn from(value: SearchEntityType) -> Self {
        match value {
            SearchEntityType::Channels => SearchIndex::Channels,
            SearchEntityType::Chats => SearchIndex::Chats,
            SearchEntityType::Documents => SearchIndex::Documents,
            SearchEntityType::Emails => SearchIndex::Emails,
            SearchEntityType::Projects => SearchIndex::Projects,
        }
    }
}
