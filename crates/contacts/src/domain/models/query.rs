//! Validated search and lookup requests for the personal directory.

use super::{contact::Contact, page::MAX_CONTACT_PAGE_SIZE};
use macro_user_id::user_id::MacroUserIdStr;
use std::collections::HashSet;
use subsequence_match::{MAX_QUERY_BYTES, normalize_text, subsequence_score};

/// Maximum source rows enriched/matched by one server search request, excluding
/// paging lookahead IDs. The response keeps a continuation at this budget.
pub const CONTACT_SEARCH_SCAN_BUDGET: u16 = 2_000;

/// A bounded query using the same name/email eligibility rules as cache search.
#[derive(Clone)]
pub struct ContactSearch(String);

impl ContactSearch {
    /// Reject oversized queries before normalizing or reading any contacts.
    pub fn new(query: &str) -> Option<Self> {
        (query.len() <= MAX_QUERY_BYTES).then(|| Self(normalize_text(query)))
    }

    /// Normalized query; empty queries are ordinary directory browsing.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Match every query token against the name/email projection, as the cache does.
    pub fn matches(&self, contact: &Contact) -> bool {
        let text = match &contact.name {
            Some(name) => format!("{name} | {}", contact.user_id.email_str()),
            None => {
                let email = contact.user_id.email_str();
                let label = email.split('@').next().unwrap_or(email);
                format!("{label} | {email}")
            }
        };
        let text = normalize_text(&text);
        self.0
            .split_whitespace()
            .all(|token| subsequence_score(&text, token).is_some())
    }
}

/// A bounded, deduplicated set of requested user IDs, in first-requested order.
#[derive(Clone)]
pub struct ContactLookup(Vec<MacroUserIdStr<'static>>);

impl ContactLookup {
    /// Bound the raw request before deduplication. Empty input means no results,
    /// never an unrestricted directory listing.
    pub fn new(mut ids: Vec<MacroUserIdStr<'static>>) -> Option<Self> {
        if ids.len() > usize::from(MAX_CONTACT_PAGE_SIZE) {
            return None;
        }
        let mut seen = HashSet::new();
        ids.retain(|id| seen.insert(id.clone()));
        Some(Self(ids))
    }

    /// Requested IDs; repository implementations must check membership before enrichment.
    pub fn ids(&self) -> &[MacroUserIdStr<'static>] {
        &self.0
    }
}

#[cfg(test)]
mod test;
