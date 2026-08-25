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
    strum::EnumIter,
    strum::IntoStaticStr,
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
    /// Name to tag this entity's clause with in a unified query, and to read
    /// back out of a hit's `matched_queries`.
    ///
    /// This is the strum representation, so the round trip is generated rather
    /// than maintained: a new variant gets a name and parses back without any
    /// list here to keep in step. Deliberately *not* the index name — the
    /// physical index a hit reports (`documents_v2`) is a deployment detail on
    /// a naming convention nothing enforces, whereas a clause name is set by
    /// the query we wrote.
    pub fn query_name(&self) -> &'static str {
        // `strum::IntoStaticStr` is what carries the 'static lifetime; the
        // `AsRefStr` impl borrows from `self`.
        self.clone().into()
    }

    /// Resolve the entity from the clause names a hit reported matching.
    ///
    /// Each entity's clause filters `_index` to its own alias, so exactly one
    /// can match a given hit. `None` means none of the names belong to a known
    /// entity, or more than one does — either way the caller must reject the
    /// hit rather than guess at it.
    pub fn from_matched_queries<'a>(names: impl IntoIterator<Item = &'a str>) -> Option<Self> {
        let mut matched = names.into_iter().filter_map(|name| name.parse().ok());
        let first = matched.next()?;
        matched.next().is_none().then_some(first)
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
    use strum::IntoEnumIterator as _;

    #[test]
    fn query_names_round_trip_for_every_variant() {
        for variant in OpenSearchEntityType::iter() {
            assert_eq!(
                OpenSearchEntityType::from_matched_queries([variant.query_name()]),
                Some(variant.clone()),
                "{} must parse back from its own query name",
                variant.query_name()
            );
        }
    }

    #[test]
    fn a_hit_matching_no_known_clause_is_rejected() {
        assert_eq!(OpenSearchEntityType::from_matched_queries([]), None);
        assert_eq!(
            OpenSearchEntityType::from_matched_queries(["reminders"]),
            None
        );
    }

    #[test]
    fn unrelated_clause_names_do_not_hide_the_entity() {
        // Naming an inner clause for debugging must not break dispatch.
        assert_eq!(
            OpenSearchEntityType::from_matched_queries(["title_term_0", "calendar_events"]),
            Some(OpenSearchEntityType::CalendarEvents)
        );
    }

    #[test]
    fn an_ambiguous_hit_is_rejected_rather_than_picked() {
        // Two entity clauses matching one hit means the query is wrong; a
        // silent first-wins choice is what this whole mechanism replaced.
        assert_eq!(
            OpenSearchEntityType::from_matched_queries(["projects", "calendar_events"]),
            None
        );
    }

    #[test]
    fn index_name_matches_search_index() {
        for variant in OpenSearchEntityType::iter() {
            let from_index: SearchIndex = variant.clone().into();
            assert_eq!(variant.index_name(), from_index.as_ref());
        }
    }
}
