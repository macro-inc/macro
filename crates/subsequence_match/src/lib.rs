//! Shared name/email/title matching for server directory reads and client cache search.
#![deny(missing_docs)]
#![forbid(unsafe_code)]

pub mod ranking;

/// Maximum raw query size accepted by the interactive search interfaces.
pub const MAX_QUERY_BYTES: usize = 512;

/// Collapse whitespace and apply Unicode lowercase, matching cached projection text.
pub fn normalize_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Score one normalized token as an ordered subsequence of normalized text.
/// Contiguous word/prefix matches score highest; gaps are measured in characters.
/// None means the token does not match. Freshness/type boosts belong to callers.
pub fn subsequence_score(haystack: &str, needle: &str) -> Option<f64> {
    if let Some(start) = haystack.find(needle) {
        let prefix = start == 0
            || haystack
                .get(..start)?
                .chars()
                .next_back()
                .is_some_and(|character| !character.is_alphanumeric());
        return Some(if prefix { 1.0 } else { 0.9 });
    }
    let mut chars = needle.chars();
    let mut wanted = chars.next()?;
    let mut first = None;
    for (position, character) in haystack.chars().enumerate() {
        if character == wanted {
            first.get_or_insert(position);
            match chars.next() {
                Some(next) => wanted = next,
                None => {
                    let span = position.saturating_sub(first.unwrap_or(position)) + 1;
                    return Some((needle.chars().count() as f64 / span as f64).clamp(0.1, 0.8));
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod test;
