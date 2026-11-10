//! Name-only matching for interactive people suggestions. Identity/address
//! classification belongs to the caller; this never supplies uniqueness proof.

use crate::{MAX_QUERY_BYTES, normalize_text};
use std::collections::BTreeSet;

/// Strict ordering of name-match stages, independent of activity scoring.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum NameMatch {
    /// Empty input uses the indexed browse order.
    Browse,
    /// Every whitespace-delimited query term occurs contiguously in the name.
    Contains,
    /// Every query word prefixes a name word, independent of word order.
    WordPrefix,
    /// The complete normalized label equals the query.
    Exact,
}

/// Prepared, bounded name input. Normalization preserves accents and scripts:
/// lowercase and whitespace collapse only, not transliteration or accent folding.
#[derive(Clone, Debug)]
pub struct NameQuery {
    normalized: String,
    words: Vec<String>,
}
impl NameQuery {
    /// Reject oversized input before allocating query terms.
    pub fn new(input: &str) -> Option<Self> {
        if input.len() > MAX_QUERY_BYTES {
            return None;
        }
        let normalized = normalize_text(input);
        let words = words(&normalized)
            .map(str::to_owned)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        Some(Self { normalized, words })
    }
    /// Normalized full query for equality/contains predicates.
    pub fn normalized(&self) -> &str {
        &self.normalized
    }
    /// Unique normalized word prefixes. An empty set is not a prefix wildcard.
    pub fn words(&self) -> impl Iterator<Item = &str> {
        self.words.iter().map(String::as_str)
    }
    /// Classify a normalized name without allocating per record. Earlier tiers
    /// take precedence; a gapped subsequence is never accepted as a fallback.
    pub fn classify_normalized(&self, name: &str) -> Option<NameMatch> {
        if self.normalized.is_empty() {
            return Some(NameMatch::Browse);
        }
        if name == self.normalized {
            return Some(NameMatch::Exact);
        }
        if !self.words.is_empty()
            && self
                .words
                .iter()
                .all(|query| words(name).any(|word| word.starts_with(query)))
        {
            return Some(NameMatch::WordPrefix);
        }
        self.normalized
            .split_whitespace()
            .all(|term| name.contains(term))
            .then_some(NameMatch::Contains)
    }
}

/// Words used by both query preparation and durable name-word derivation.
/// Callers supply normalized text; punctuation separates words, not identities.
pub fn words(normalized: &str) -> impl Iterator<Item = &str> {
    normalized
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
}

#[cfg(test)]
mod test;
