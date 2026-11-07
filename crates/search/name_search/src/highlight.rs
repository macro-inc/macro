//! In-memory name highlighting that mirrors the Postgres
//! `regexp_replace(..., 'gi')` applied by the SQL name-search queries.

use crate::escape_regex;

const OPEN_TAG: &str = "<macro_em>";
const CLOSE_TAG: &str = "</macro_em>";

/// Applies the same `<macro_em>` name-highlight replacement that the Postgres
/// name-search queries apply via `regexp_replace(..., 'gi')`, but against an
/// in-memory name string. Returns `None` when the term is empty or the name
/// does not contain the term (case-insensitive).
pub fn highlight_name(name: &str, term: &str) -> Option<String> {
    highlight_name_terms(name, &[term])
}

/// Wraps every case-insensitive occurrence of each of `terms` in `name` in
/// `<macro_em>` tags. Overlapping and adjacent matches merge into one span so
/// tags never nest. Returns `None` when the terms are blank or none of them
/// occurs in the name.
pub(crate) fn highlight_name_terms(name: &str, terms: &[&str]) -> Option<String> {
    let mut ranges: Vec<(usize, usize)> = Vec::new();
    for term in terms
        .iter()
        .map(|term| term.trim())
        .filter(|term| !term.is_empty())
    {
        let re = regex::Regex::new(&format!("(?i){}", escape_regex(term))).ok()?;
        ranges.extend(re.find_iter(name).map(|m| (m.start(), m.end())));
    }
    if ranges.is_empty() {
        return None;
    }
    ranges.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(ranges.len());
    for (start, end) in ranges {
        match merged.last_mut() {
            Some((_, last_end)) if start <= *last_end => *last_end = (*last_end).max(end),
            _ => merged.push((start, end)),
        }
    }

    let mut highlighted =
        String::with_capacity(name.len() + merged.len() * (OPEN_TAG.len() + CLOSE_TAG.len()));
    let mut copied_to = 0;
    for (start, end) in merged {
        highlighted.push_str(&name[copied_to..start]);
        highlighted.push_str(OPEN_TAG);
        highlighted.push_str(&name[start..end]);
        highlighted.push_str(CLOSE_TAG);
        copied_to = end;
    }
    highlighted.push_str(&name[copied_to..]);
    Some(highlighted)
}

#[cfg(test)]
mod test;
