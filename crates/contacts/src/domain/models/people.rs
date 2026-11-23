//! Ranked people search over the viewer's contacts and current team.

use super::contact::Contact;
use subsequence_match::{
    MAX_QUERY_BYTES,
    names::{NameMatch, NameQuery},
    normalize_text,
};

#[cfg(test)]
mod test;

/// Shortest trimmed query, in characters, that reads any people.
pub const MIN_PEOPLE_SEARCH_CHARS: usize = 2;

/// Results returned when the caller gives no limit.
pub const DEFAULT_PEOPLE_SEARCH_LIMIT: u8 = 20;

/// Most results one search can return, whatever the caller asks for.
pub const MAX_PEOPLE_SEARCH_LIMIT: u8 = 50;

/// Trimmed, lowercased search text. Too-short text is kept so the caller gets
/// an empty answer instead of an error, but it never reaches storage.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PeopleSearchQuery(String);

impl PeopleSearchQuery {
    /// Reject text over the shared search byte bound before trimming.
    pub fn new(query: &str) -> Option<Self> {
        (query.len() <= MAX_QUERY_BYTES).then(|| Self(query.trim().to_lowercase()))
    }

    /// The text to match, or None when it is too short to search.
    pub fn searchable(&self) -> Option<&str> {
        (self.0.chars().count() >= MIN_PEOPLE_SEARCH_CHARS).then_some(self.0.as_str())
    }

    /// Byte length of the normalized text, for telemetry.
    pub fn byte_len(&self) -> usize {
        self.0.len()
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

/// Most distinct words a named-people query may hold, as the local people
/// ranking bounds its queries.
pub const MAX_NAMED_WORDS: usize = 32;

/// How typed text names a person, best first.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum NamedBy {
    /// The whole name, or for a one-word text the first name, equals the text.
    Exact,
    /// Every typed word starts a word of the name.
    WordStart,
}

/// Typed text prepared to find the people it names, by the local people
/// ranking's two name stages (`subsequence_match::names`).
#[derive(Clone, Debug)]
pub struct NamedPeopleQuery {
    text: String,
    query: NameQuery,
    identity: bool,
}

impl NamedPeopleQuery {
    /// None for text over the shared search byte bound or with more than
    /// `MAX_NAMED_WORDS` distinct words.
    pub fn new(text: &str) -> Option<Self> {
        let query = NameQuery::new(text)?;
        if query.words().count() > MAX_NAMED_WORDS {
            return None;
        }
        // An address or user id identifies one person; the local ranking
        // never matches it against names.
        let trimmed = text.trim();
        let identity = trimmed.contains('@')
            || trimmed
                .get(..6)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case("macro|"));
        Some(Self {
            text: trimmed.to_owned(),
            query,
            identity,
        })
    }

    /// The text as typed, trimmed. Storage normalizes it with the names it
    /// compares, so both sides follow one set of case rules.
    pub fn text(&self) -> &str {
        &self.text
    }

    /// Whether the text can name anyone: it holds a letter or digit and is
    /// not an address or user id.
    pub fn names_anyone(&self) -> bool {
        !self.identity && self.query.words().next().is_some()
    }

    /// The text lowercased, with runs of whitespace collapsed.
    pub fn normalized(&self) -> &str {
        self.query.normalized()
    }

    /// The text's distinct words, split on anything but letters and digits.
    pub fn words(&self) -> Vec<&str> {
        self.query.words().collect()
    }

    /// How the text names `contact`, by the name the directory shows it with,
    /// or the local part of its address when it has none, as the local cache
    /// names it.
    pub fn named_by(&self, contact: &Contact) -> Option<NamedBy> {
        if !self.names_anyone() {
            return None;
        }
        let email = contact.user_id.email_str();
        let name = contact
            .name
            .as_deref()
            .unwrap_or_else(|| email.split('@').next().unwrap_or(email));
        match self.query.classify_normalized(&normalize_text(name))? {
            NameMatch::Exact => Some(NamedBy::Exact),
            NameMatch::WordPrefix => Some(NamedBy::WordStart),
            NameMatch::Browse | NameMatch::Contains => None,
        }
    }
}
