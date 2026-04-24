#![deny(missing_docs)]
//! This crate contains models used by opensearch.
//! This crate should never contain utoipa or any service-level models.
//! This is purely a crate containing models used for opensearch directly.

/// Enum for all the search indices in OpenSearch
#[derive(Debug, Clone, Hash, Eq, PartialEq, strum::Display, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "lowercase")]
pub enum SearchIndex {
    /// The channel index
    Channels,
    /// The chat index
    Chats,
    /// The document index
    Documents,
    /// aliased email index
    #[strum(serialize = "emails_alias")]
    Emails,
    /// aliased call records index
    #[strum(serialize = "call_records_alias")]
    CallRecords,
}

/// All searchable entity types. Projects are Postgres-only.
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
    /// The channel entity type (has OpenSearch index)
    Channels,
    /// The chat entity type (has OpenSearch index)
    Chats,
    /// The document entity type (has OpenSearch index)
    Documents,
    /// The email entity type (has OpenSearch index)
    Emails,
    /// The project entity type (Postgres-only)
    Projects,
    /// The call records entity type (has OpenSearch index)
    #[strum(serialize = "call_records")]
    #[serde(rename = "call_records")]
    CallRecords,
}

/// `SearchEntityType` variants that have an OpenSearch index.
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
pub enum OpenSearchEntityType {
    /// The channel index
    Channels,
    /// The chat index
    Chats,
    /// The document index
    Documents,
    /// The email index
    Emails,
    /// The call records index
    #[strum(serialize = "call_records")]
    #[serde(rename = "call_records")]
    CallRecords,
}

impl OpenSearchEntityType {
    /// Returns the index name to use for OpenSearch queries.
    pub fn index_name(&self) -> &'static str {
        match self {
            Self::Channels => "channels",
            Self::Chats => "chats",
            Self::Documents => "documents",
            Self::Emails => "emails_alias",
            Self::CallRecords => "call_records_alias",
        }
    }
}

impl From<OpenSearchEntityType> for SearchEntityType {
    fn from(value: OpenSearchEntityType) -> Self {
        match value {
            OpenSearchEntityType::Channels => SearchEntityType::Channels,
            OpenSearchEntityType::Chats => SearchEntityType::Chats,
            OpenSearchEntityType::Documents => SearchEntityType::Documents,
            OpenSearchEntityType::Emails => SearchEntityType::Emails,
            OpenSearchEntityType::CallRecords => SearchEntityType::CallRecords,
        }
    }
}

impl From<OpenSearchEntityType> for SearchIndex {
    fn from(value: OpenSearchEntityType) -> Self {
        match value {
            OpenSearchEntityType::Channels => SearchIndex::Channels,
            OpenSearchEntityType::Chats => SearchIndex::Chats,
            OpenSearchEntityType::Documents => SearchIndex::Documents,
            OpenSearchEntityType::Emails => SearchIndex::Emails,
            OpenSearchEntityType::CallRecords => SearchIndex::CallRecords,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn index_name_matches_search_index() {
        for variant in [
            OpenSearchEntityType::Channels,
            OpenSearchEntityType::Chats,
            OpenSearchEntityType::Documents,
            OpenSearchEntityType::Emails,
            OpenSearchEntityType::CallRecords,
        ] {
            let from_index: SearchIndex = variant.clone().into();
            assert_eq!(variant.index_name(), from_index.as_ref());
        }
    }
}
