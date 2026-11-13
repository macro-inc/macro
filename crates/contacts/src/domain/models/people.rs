//! Ranked people search over the viewer's contacts and current team.

use super::contact::Contact;
use subsequence_match::MAX_QUERY_BYTES;

#[cfg(test)]
mod test;

/// Shortest trimmed query, in characters, that reads any people.
pub const MIN_PEOPLE_SEARCH_CHARS: usize = 2;

/// Results returned when the caller gives no limit.
pub const DEFAULT_PEOPLE_SEARCH_LIMIT: u8 = 20;

/// Most results one search can return, whatever the caller asks for.
pub const MAX_PEOPLE_SEARCH_LIMIT: u8 = 50;

/// How a search orders the people it matches before applying its limit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum PeopleSearchRanking {
    /// Teammates first, then prefix matches: what a directory typeahead shows.
    #[default]
    TeammatesFirst,
    /// People whose full name, first name or email address is the query
    /// first, then the rest as [`Self::TeammatesFirst`]: for resolving a name
    /// someone wrote, where an exact match must not fall past the limit.
    ExactFirst,
}

/// Trimmed, lowercased search text and its ranking. Too-short text is kept so
/// the caller gets an empty answer instead of an error, but it never reaches
/// storage.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PeopleSearchQuery {
    text: String,
    ranking: PeopleSearchRanking,
}

impl PeopleSearchQuery {
    /// Reject text over the shared search byte bound before trimming. The
    /// query ranks teammates first.
    pub fn new(query: &str) -> Option<Self> {
        (query.len() <= MAX_QUERY_BYTES).then(|| Self {
            text: query.trim().to_lowercase(),
            ranking: PeopleSearchRanking::default(),
        })
    }

    /// The same query, ranking exact matches first.
    pub fn exact_first(self) -> Self {
        Self {
            ranking: PeopleSearchRanking::ExactFirst,
            ..self
        }
    }

    /// The text to match, or None when it is too short to search.
    pub fn searchable(&self) -> Option<&str> {
        (self.text.chars().count() >= MIN_PEOPLE_SEARCH_CHARS).then_some(self.text.as_str())
    }

    /// How the search orders its matches.
    pub fn ranking(&self) -> PeopleSearchRanking {
        self.ranking
    }

    /// Byte length of the normalized text, for telemetry.
    pub fn byte_len(&self) -> usize {
        self.text.len()
    }
}

/// Result count for one search: zero is rejected, anything over the maximum is capped.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PeopleSearchLimit(u8);

impl PeopleSearchLimit {
    /// Limit used when the request gives none.
    pub const DEFAULT: Self = Self(DEFAULT_PEOPLE_SEARCH_LIMIT);

    /// Cap a requested limit at the maximum; None for zero.
    pub fn new(requested: u32) -> Option<Self> {
        let capped = requested.min(u32::from(MAX_PEOPLE_SEARCH_LIMIT));
        (capped > 0).then(|| Self(u8::try_from(capped).unwrap_or(MAX_PEOPLE_SEARCH_LIMIT)))
    }

    /// Maximum number of results.
    pub fn get(self) -> u8 {
        self.0
    }
}

/// One ranked search result.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PersonMatch {
    /// The person as a directory entry of this viewer, with the directory's resolved name.
    pub contact: Contact,
    /// Whether the person is a member of the viewer's current team.
    pub is_teammate: bool,
    /// Whether the person is an agent principal rather than a human; false for non-Macro contacts.
    pub is_agent: bool,
}
