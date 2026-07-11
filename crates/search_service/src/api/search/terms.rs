//! Shared search-term parsing.
//!
//! [`split_search_terms`] tokenizes user input by whitespace while preserving
//! double-quoted phrases so callers can build AND-of-terms queries where each
//! quoted span counts as a single phrase term. Used by both the unified
//! dispatch and the channel-only endpoint.

/// Splits search terms by whitespace, preserving double-quoted phrases.
/// e.g. `["hello world"]` → `["hello", "world"]`
/// e.g. `[r#""hello world" test"#]` → `["hello world", "test"]`
pub(in crate::api::search) fn split_search_terms(terms: &[String]) -> Vec<String> {
    let joined = terms.join(" ");
    let mut result = Vec::new();
    // Regex-free parser: iterate chars, track quoted state
    let mut current = String::new();
    let mut in_quotes = false;
    for c in joined.chars() {
        match c {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                let trimmed = current.trim().to_string();
                if !trimmed.is_empty() {
                    result.push(trimmed);
                }
                current.clear();
            }
            _ => current.push(c),
        }
    }
    let trimmed = current.trim().to_string();
    if !trimmed.is_empty() {
        result.push(trimmed);
    }
    result
}

#[cfg(test)]
mod test;
