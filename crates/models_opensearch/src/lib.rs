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
    /// The projects alias
    Projects,
    /// The calendar events alias
    CalendarEvents,
}

/// All searchable entity types — the tag on a unified `SearchHit`,
/// independent of where the hit came from. Most are backed by an
/// OpenSearch index, but some (CrmCompanies) are Postgres-only and
/// synthesized by name searches; those never appear in OpenSearch
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
    /// The project entity type (has OpenSearch index)
    Projects,
    /// The call records entity type (has OpenSearch index)
    CallRecords,
    /// The CRM company entity type (Postgres-only)
    CrmCompanies,
    /// The calendar event entity type (has OpenSearch index)
    CalendarEvents,
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
    /// The projects index
    Projects,
    /// The calendar events index
    CalendarEvents,
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
            Self::Projects => "projects",
            Self::CalendarEvents => "calendar_events",
        }
    }
}

impl OpenSearchEntityType {
    /// Resolve the index name OpenSearch reports on a hit back to its entity.
    ///
    /// Hits carry the *physical* index (`documents_v2`), never the alias
    /// (`documents`), so this accepts either: the alias itself, or the alias
    /// followed by `_` and a version suffix. No alias is a prefix of another,
    /// so the match is unambiguous.
    ///
    /// `None` means the index is not one this crate knows — a hit from an
    /// index the caller never asked for, which the caller should reject rather
    /// than guess about.
    pub fn from_index_name(index: &str) -> Option<Self> {
        [
            Self::Channels,
            Self::Chats,
            Self::Documents,
            Self::Emails,
            Self::CallRecords,
            Self::Projects,
            Self::CalendarEvents,
        ]
        .into_iter()
        .find(|entity| {
            let alias = entity.index_name();
            index == alias
                || index
                    .strip_prefix(alias)
                    .is_some_and(|suffix| suffix.starts_with('_'))
        })
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
            OpenSearchEntityType::Projects => SearchEntityType::Projects,
            OpenSearchEntityType::CalendarEvents => SearchEntityType::CalendarEvents,
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
            OpenSearchEntityType::Projects => SearchIndex::Projects,
            OpenSearchEntityType::CalendarEvents => SearchIndex::CalendarEvents,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn resolves_physical_index_names_back_to_their_entity() {
        // What OpenSearch actually reports on a hit.
        assert_eq!(
            OpenSearchEntityType::from_index_name("calendar_events_v1"),
            Some(OpenSearchEntityType::CalendarEvents)
        );
        assert_eq!(
            OpenSearchEntityType::from_index_name("documents_v2"),
            Some(OpenSearchEntityType::Documents)
        );
        // The alias on its own resolves too.
        assert_eq!(
            OpenSearchEntityType::from_index_name("projects"),
            Some(OpenSearchEntityType::Projects)
        );
        // `call_records` and `calendar_events` share a prefix but neither
        // prefixes the other, so they never cross-match.
        assert_eq!(
            OpenSearchEntityType::from_index_name("call_records_v2"),
            Some(OpenSearchEntityType::CallRecords)
        );
        // An index this crate does not know is not guessed at.
        assert_eq!(OpenSearchEntityType::from_index_name("reminders_v1"), None);
        assert_eq!(OpenSearchEntityType::from_index_name(""), None);
        // A longer alias must not be swallowed by a shorter unrelated one.
        assert_eq!(OpenSearchEntityType::from_index_name("chatsomething"), None);
    }

    #[test]
    fn every_variant_round_trips_through_its_physical_name() {
        for variant in [
            OpenSearchEntityType::Channels,
            OpenSearchEntityType::Chats,
            OpenSearchEntityType::Documents,
            OpenSearchEntityType::Emails,
            OpenSearchEntityType::CallRecords,
            OpenSearchEntityType::Projects,
            OpenSearchEntityType::CalendarEvents,
        ] {
            let physical = format!("{}_v9", variant.index_name());
            assert_eq!(
                OpenSearchEntityType::from_index_name(&physical),
                Some(variant.clone()),
                "{physical} must resolve back to its own entity"
            );
        }
    }

    #[test]
    fn index_name_matches_search_index() {
        for variant in [
            OpenSearchEntityType::Channels,
            OpenSearchEntityType::Chats,
            OpenSearchEntityType::Documents,
            OpenSearchEntityType::Emails,
            OpenSearchEntityType::CallRecords,
            OpenSearchEntityType::Projects,
            OpenSearchEntityType::CalendarEvents,
        ] {
            let from_index: SearchIndex = variant.clone().into();
            assert_eq!(variant.index_name(), from_index.as_ref());
        }
    }
}
