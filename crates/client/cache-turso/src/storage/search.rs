//! Bucket scans for the core's Unicode-normalized subsequence search. Rows
//! stream from the covering browse index, and a byte-level subsequence test
//! drops rows no token can match before the core scores the rest, without a
//! limit. Turso's LIKE does the same test several times slower per token, so
//! only the contact search, which must skip decoding records, still filters in
//! SQL.

use super::{SEARCH_LOAD, SearchProfile, SearchQuery, driver, text};
use crate::{PhysicalResetReason, TursoStorageError, key::RecordKey};
use cache_core::search::SearchDocumentRef;
use turso_core::{Numeric, Row, Value};

pub(super) fn visit_row(
    row: &Row,
    profile: SearchProfile,
    query: &SearchQuery,
    key_buffer: &mut String,
    visit: &mut impl FnMut(SearchDocumentRef<'_>),
) -> Result<(), TursoStorageError> {
    let mut values = row.get_values();
    let (
        Some(Value::Text(typename)),
        Some(Value::Text(id)),
        Some(Value::Text(bucket)),
        Some(Value::Text(search_text)),
        Some(Value::Numeric(Numeric::Integer(timestamp_ms))),
        Some(Value::Text(source_hash)),
        None,
    ) = (
        values.next(),
        values.next(),
        values.next(),
        values.next(),
        values.next(),
        values.next(),
        values.next(),
    )
    else {
        return Err(TursoStorageError::reset(PhysicalResetReason::Corruption));
    };
    if !may_match(query, search_text.as_str()) {
        return Ok(());
    }
    let record_key = RecordKey::borrow_entity(typename.as_str(), id.as_str(), key_buffer)?;
    visit(SearchDocumentRef {
        profile,
        record_key: &record_key,
        bucket: bucket.as_str(),
        search_text: search_text.as_str(),
        timestamp_ms: *timestamp_ms,
        source_hash: source_hash.as_str(),
    });
    Ok(())
}

/// Every row of one profile bucket; [`visit_row`] applies the query.
pub(super) fn statement(profile: SearchProfile, bucket: &str) -> (String, driver::Values) {
    (
        SEARCH_LOAD.to_owned(),
        vec![text(profile.as_str()), text(bucket)],
    )
}

/// Whether every token of `query` occurs in `text` as an ordered subsequence of
/// bytes. A token whose characters occur in order also has its UTF-8 bytes in
/// order, so this keeps every row the core's character match accepts.
pub(super) fn may_match(query: &SearchQuery, text: &str) -> bool {
    let text = text.as_bytes();
    query.tokens().all(|token| {
        let mut rest = text;
        token.bytes().all(
            |byte| match rest.iter().position(|candidate| *candidate == byte) {
                Some(at) => {
                    rest = rest.get(at + 1..).unwrap_or_default();
                    true
                }
                None => false,
            },
        )
    })
}

pub(super) fn statement_with_base(
    base: &str,
    profile: SearchProfile,
    bucket: &str,
    query: &SearchQuery,
) -> (String, driver::Values) {
    let mut sql = base.to_owned();
    let mut values = vec![text(profile.as_str()), text(bucket)];
    let mut tokens = query.tokens().peekable();
    if tokens.peek().is_some() {
        sql.push_str(" AND ((");
        for (index, token) in tokens.enumerate() {
            if index > 0 {
                sql.push_str(" AND ");
            }
            sql.push_str("search_text LIKE ? ESCAPE '\\'");
            let mut pattern = String::from("%");
            for character in token.chars() {
                if matches!(character, '%' | '_' | '\\') {
                    pattern.push('\\');
                }
                pattern.push(character);
                pattern.push('%');
            }
            values.push(text(&pattern));
        }
        // SQLite LIKE stops at NUL, while Rust's matching does not. Include
        // these rare rows as a superset and let the ranker decide the match.
        sql.push_str(") OR instr(search_text, char(0)) > 0)");
    }
    (sql, values)
}
