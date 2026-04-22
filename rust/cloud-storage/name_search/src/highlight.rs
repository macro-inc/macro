//! In-memory name highlighting that mirrors the Postgres
//! `regexp_replace(..., 'gi')` applied by the SQL name-search queries.

use crate::escape_regex;

/// Applies the same `<macro_em>` name-highlight replacement that the Postgres
/// name-search queries apply via `regexp_replace(..., 'gi')`, but against an
/// in-memory name string. Returns `None` when the term is empty or the name
/// does not contain the term (case-insensitive).
pub fn highlight_name(name: &str, term: &str) -> Option<String> {
    let term = term.trim();
    if term.is_empty() {
        return None;
    }
    let re = regex::Regex::new(&format!("(?i)({})", escape_regex(term))).ok()?;
    if !re.is_match(name) {
        return None;
    }
    Some(re.replace_all(name, "<macro_em>$1</macro_em>").into_owned())
}

#[cfg(test)]
mod test;
