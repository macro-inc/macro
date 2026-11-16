//! Shared matching and durable sort-key semantics for the name-first people path.
//! The active menu reader is switched only with its storage/host integration.
use super::PeopleError;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use subsequence_match::{
    MAX_QUERY_BYTES,
    names::{NameMatch, NameQuery},
};
use uuid::Uuid;

pub mod projection;
pub mod reader;

/// Matching stages, highest priority last. Suggestions are not uniqueness proof.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum NameStage {
    /// Empty query, ordered by current published recency.
    Browse,
    /// Literal per-term containment in a name, never arbitrary gaps.
    Contains,
    /// Every query word prefixes a name word.
    WordPrefix,
    /// Exact normalized full name.
    ExactName,
    /// An incomplete typed address prefixes the actual email.
    EmailPrefix,
    /// An explicit identity or complete email matches only that identity.
    Identity,
}

/// Input classification shared by the core ranker and its storage planner.
#[derive(Clone, Debug)]
pub enum NameSearch {
    /// Prepared name terms, including empty browsing.
    Name(NameQuery),
    /// Only actual email prefixes, never a display-name alias.
    EmailPrefix(String),
    /// Canonical explicit identity, including complete email input.
    Identity(MacroUserIdStr<'static>),
}
impl NameSearch {
    /// Parse before reading storage. Preserve strict identity markers; do not
    /// normalize a malformed marker into authority for another person's alias.
    pub fn new(input: &str) -> Result<Self, PeopleError> {
        if input.len() > MAX_QUERY_BYTES {
            return Err(PeopleError::InvalidInput);
        }
        let input = input.trim();
        if input
            .get(..6)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case("macro|"))
        {
            return MacroUserIdStr::parse_from_str(input)
                .map(|id| Self::Identity(id.into_owned()))
                .map_err(|_| PeopleError::InvalidInput);
        }
        if input.contains('@') {
            return Ok(match MacroUserIdStr::try_from_email(input) {
                Ok(id) => Self::Identity(id.into_owned()),
                Err(_) => Self::EmailPrefix(input.to_lowercase()),
            });
        }
        NameQuery::new(input)
            .map(Self::Name)
            .ok_or(PeopleError::InvalidInput)
    }
    /// Classify normalized name and canonical identity; callers establish
    /// membership before invoking this method or exposing the label.
    pub fn classify(&self, normalized_name: &str, user: &MacroUserIdStr<'_>) -> Option<NameStage> {
        match self {
            Self::Identity(id) => (id.as_ref() == user.as_ref()).then_some(NameStage::Identity),
            Self::EmailPrefix(prefix) => user
                .email_str()
                .starts_with(prefix)
                .then_some(NameStage::EmailPrefix),
            Self::Name(query) => {
                query
                    .classify_normalized(normalized_name)
                    .map(|tier| match tier {
                        NameMatch::Browse => NameStage::Browse,
                        NameMatch::Contains => NameStage::Contains,
                        NameMatch::WordPrefix => NameStage::WordPrefix,
                        NameMatch::Exact => NameStage::ExactName,
                    })
            }
        }
    }
}

/// Lexicographic recent-first key: descending signed timestamp, then canonical
/// user ID. Never uses an index-document row ID, which may change on rebuild.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct RecentKey(Vec<u8>);
impl RecentKey {
    /// Missing activity retains the existing zero-timestamp convention.
    pub fn new(timestamp: Option<i64>, user: &MacroUserIdStr<'_>) -> Self {
        let mut time = timestamp.unwrap_or(0).to_be_bytes();
        time[0] ^= 0x80;
        for byte in &mut time {
            *byte = !*byte;
        }
        let mut bytes = Vec::with_capacity(time.len() + user.as_ref().len());
        bytes.extend_from_slice(&time);
        bytes.extend_from_slice(user.as_ref().as_bytes());
        Self(bytes)
    }
    /// Exact BLOB bytes used by the existing fact index.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0
    }
    /// Sparse context overrides are partitioned by publication epoch. Old
    /// epochs remain harmless while the default rank supplies untouched users.
    pub fn in_epoch(&self, epoch: Uuid) -> Vec<u8> {
        [epoch.as_bytes().as_slice(), self.as_bytes()].concat()
    }
}

/// Exclusive BLOB upper bound for a prefix. None means unbounded above, not an
/// empty interval (including an all-0xff epoch). Does not assume UTF-8 in bounds.
pub fn prefix_end(prefix: &[u8]) -> Option<Vec<u8>> {
    let mut end = prefix.to_vec();
    while let Some(last) = end.pop() {
        if last != u8::MAX {
            end.push(last + 1);
            return Some(end);
        }
    }
    None
}

#[cfg(test)]
mod test;
