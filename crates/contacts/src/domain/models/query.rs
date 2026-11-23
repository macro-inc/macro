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
pub struct ContactSearch {
    query: String,
    predicate: ContactPredicate,
}

#[derive(Clone, Copy)]
enum ContactPredicate {
    Subsequence,
    Exact,
    FirstName,
    AnyName,
}

impl ContactSearch {
    /// Reject oversized queries before normalizing or reading any contacts.
    pub fn new(query: &str) -> Option<Self> {
        Self::with_predicate(query, ContactPredicate::Subsequence)
    }

    /// Match a whole name, address or canonical identity, before the result limit.
    pub fn exact(query: &str) -> Option<Self> {
        Self::with_predicate(query, ContactPredicate::Exact)
    }

    /// Match the first word of a resolved name, not an invented email local-part name.
    pub fn first_name(query: &str) -> Option<Self> {
        Self::with_predicate(query, ContactPredicate::FirstName)
    }

    /// Match whole and first names equally, as inferred user property values do.
    pub fn any_name(query: &str) -> Option<Self> {
        Self::with_predicate(query, ContactPredicate::AnyName)
    }

    fn with_predicate(query: &str, predicate: ContactPredicate) -> Option<Self> {
        if query.len() > MAX_QUERY_BYTES {
            return None;
        }
        let query = normalize_text(query);
        if query.is_empty() && !matches!(predicate, ContactPredicate::Subsequence) {
            return None;
        }
        Some(Self { query, predicate })
    }

    /// Normalized query; empty subsequence queries are ordinary browsing.
    pub fn as_str(&self) -> &str {
        &self.query
    }

    /// Evaluate the selected eligibility rule on an already-authorized contact.
    pub fn matches(&self, contact: &Contact) -> bool {
        match self.predicate {
            ContactPredicate::Subsequence => self.matches_subsequence(contact),
            ContactPredicate::Exact | ContactPredicate::FirstName | ContactPredicate::AnyName => {
                let full_name = normalize_text(
                    contact
                        .name
                        .as_deref()
                        .unwrap_or(contact.user_id.email_str()),
                );
                let exact = self.query == full_name
                    || self.query == contact.user_id.as_ref()
                    || self.query == contact.user_id.email_str();
                let first = full_name.split_whitespace().next() == Some(self.query.as_str());
                (matches!(
                    self.predicate,
                    ContactPredicate::Exact | ContactPredicate::AnyName
                ) && exact)
                    || (matches!(
                        self.predicate,
                        ContactPredicate::FirstName | ContactPredicate::AnyName
                    ) && first)
            }
        }
    }

    fn matches_subsequence(&self, contact: &Contact) -> bool {
        let text = match &contact.name {
            Some(name) => format!("{name} | {}", contact.user_id.email_str()),
            None => {
                let email = contact.user_id.email_str();
                let label = email.split('@').next().unwrap_or(email);
                format!("{label} | {email}")
            }
        };
        let text = normalize_text(&text);
        self.query
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
