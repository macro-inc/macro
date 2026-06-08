#![deny(missing_docs)]
//! This crate contains models used by opensearch.
//! This crate should never contain utoipa or any service-level models.
//! This is purely a crate containing models used for opensearch directly.

/// Enum for all the search indices in OpenSearch.
///
/// Every variant resolves to a stable alias name. The underlying physical
/// indices live behind the alias and can be swapped via the OpenSearch
/// `_aliases` API to support zero-downtime reindexing.
#[derive(Debug, Clone, Hash, Eq, PartialEq, strum::Display, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum SearchIndex {
    /// The channel alias
    Channels,
    /// The chat alias
    Chats,
    /// The document alias
    Documents,
    /// The email alias
    Emails,
    /// The call records alias
    CallRecords,
}

/// All searchable entity types — the tag on a unified `SearchHit`,
/// independent of where the hit came from. Most are backed by an
/// OpenSearch index, but some (Projects, CrmCompanies) are Postgres-only
/// and synthesized by name searches; those never appear in OpenSearch
/// responses. The OpenSearch-backed subset is [`OpenSearchEntityType`].
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
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
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
    CallRecords,
    /// The CRM company entity type (Postgres-only)
    CrmCompanies,
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
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
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
    CallRecords,
}

impl OpenSearchEntityType {
    /// Returns the alias name to use for OpenSearch queries. The alias points
    /// at the current physical index for this entity; reindexes swap the alias
    /// without requiring a code change here.
    pub fn index_name(&self) -> &'static str {
        match self {
            Self::Channels => "channels",
            Self::Chats => "chats",
            Self::Documents => "documents",
            Self::Emails => "emails",
            Self::CallRecords => "call_records",
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
