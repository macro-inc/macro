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
use models_search_cursor::CursorTermMatching;
use opensearch_client::search::documents::{DocumentTermMatching, MIN_TERMS_FOR_DYNAMIC_MATCHING};

use crate::TermMatchingRollout;

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
///
/// A later page runs the mode its first page ran (`first_page_mode`, carried
/// in the cursor) instead of reading the rollout again. Each process learns a
/// caller's rollout answer on its own, so asking again could switch the mode
/// between two pages of one search. The request still has to ask: a cursor
/// cannot turn dynamic matching on by itself.
pub(in crate::api::search) async fn resolve_document_term_matching(
    rollout: &dyn TermMatchingRollout,
    caller: &str,
    requested: TermMatching,
    term_count: usize,
    first_page_mode: Option<CursorTermMatching>,
) -> DocumentTermMatching {
    if requested != TermMatching::Dynamic || term_count < MIN_TERMS_FOR_DYNAMIC_MATCHING {
        return DocumentTermMatching::All;
    }
    match first_page_mode {
        Some(CursorTermMatching::All) => return DocumentTermMatching::All,
        Some(CursorTermMatching::Dynamic) => return DocumentTermMatching::Dynamic,
        None => {}
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

/// The mode to carry in the next page's cursor: the one this page ran, for a
/// request that asked for dynamic matching. Other requests always run strict,
/// so their cursors carry nothing and stay as they were.
pub(in crate::api::search) fn term_matching_for_cursor(
    requested: TermMatching,
    resolved: DocumentTermMatching,
) -> Option<CursorTermMatching> {
    if requested != TermMatching::Dynamic {
        return None;
    }
    Some(match resolved {
        DocumentTermMatching::All => CursorTermMatching::All,
        DocumentTermMatching::Dynamic => CursorTermMatching::Dynamic,
    })
}

#[cfg(test)]
mod test;
