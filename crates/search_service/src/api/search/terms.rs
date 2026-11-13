//! Shared search-term parsing.
//!
//! [`split_search_terms`] tokenizes user input by whitespace while preserving
//! double-quoted phrases so callers can build AND-of-terms queries where each
//! quoted span counts as a single phrase term. Used by both the unified
//! dispatch and the channel-only endpoint. [`drop_wordless_terms`] then removes
//! the terms no indexed text can match, and [`resolve_document_term_matching`]
//! decides how the remaining terms combine on document content.

use macro_user_id::user_id::MacroUserIdStr;
use models_search::{MatchType, TermMatching};
use opensearch_client::search::documents::{DocumentTermMatching, MIN_TERMS_FOR_DYNAMIC_MATCHING};

use crate::TermMatchingRollout;
use crate::api::search::simple::SearchError;

/// Trims a query and rejects one that holds no search term: only whitespace
/// and the double quotes [`split_search_terms`] strips. One character is
/// enough: the query builders match a term under three characters as a whole
/// word in document, chat, call and email content and cap every prefix
/// expansion, so a short query costs no more than a common longer word.
pub(in crate::api::search) fn trimmed_query(query: &str) -> Result<&str, SearchError> {
    let query = query.trim();
    if query.chars().all(|c| c.is_whitespace() || c == '"') {
        return Err(SearchError::EmptyQuery);
    }
    Ok(query)
}

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

/// Drops the terms the index can never match. The indexed text fields use the
/// standard tokenizer, which turns a term with no letter or digit (`-`, `@`,
/// `&`) into no tokens at all, and one such clause among the ANDed terms makes
/// the whole query match nothing: `OOO - therapy` missed `OOO - therapy`.
/// Regexp and query-string input keep every term, because punctuation is
/// syntax there, and a query made only of such terms is left unchanged.
pub(in crate::api::search) fn drop_wordless_terms(
    terms: Vec<String>,
    match_type: MatchType,
) -> Vec<String> {
    if matches!(match_type, MatchType::Regexp | MatchType::Query) {
        return terms;
    }
    let has_word = |term: &String| term.chars().any(char::is_alphanumeric);
    if !terms.iter().any(has_word) {
        return terms;
    }
    terms.into_iter().filter(has_word).collect()
}

/// Records on `span` how many terms a search kept and how many
/// [`drop_wordless_terms`] removed. The span declares both fields.
pub(in crate::api::search) fn record_term_counts(
    span: &tracing::Span,
    kept: usize,
    dropped: usize,
) {
    span.record("search.terms", kept);
    span.record("search.dropped_terms", dropped);
}

/// Decide how a search's terms match document content.
///
/// Dynamic matching changes which documents match, so it needs both the
/// request to ask for it and the rollout to allow the caller. A request that
/// does not ask (the SDK, AI tools) never reads the rollout, and neither does
/// a query too short for dynamic matching to change.
pub(in crate::api::search) async fn resolve_document_term_matching(
    rollout: &dyn TermMatchingRollout,
    caller: &str,
    requested: TermMatching,
    term_count: usize,
) -> DocumentTermMatching {
    if requested != TermMatching::Dynamic || term_count < MIN_TERMS_FOR_DYNAMIC_MATCHING {
        return DocumentTermMatching::All;
    }
    let Ok(caller) = MacroUserIdStr::parse_from_str(caller) else {
        return DocumentTermMatching::All;
    };
    if rollout.dynamic_enabled_for(caller).await {
        DocumentTermMatching::Dynamic
    } else {
        DocumentTermMatching::All
    }
}

#[cfg(test)]
mod test;
