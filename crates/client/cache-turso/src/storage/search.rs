//! Search rows and the scans over them.
//!
//! Each profile bucket has a slot in `search_slots`, and every row of a bucket
//! has a row id in its slot's range: the slot shifted left by [`SLOT_SHIFT`]
//! bits plus a sequence number. A bucket's rows are therefore contiguous in the
//! table, so the core's subsequence search reads one bucket as a range of the
//! table, and the browse index holds only the order (slot, recency, key)
//! instead of a second copy of every text.
//!
//! Rows stream from that range, and a byte-level subsequence test drops rows
//! no token can match before the core scores the rest, without a limit.
//! Turso's LIKE does the same test several times slower per token, so only the
//! contact search, which must skip decoding records, still filters in SQL.

use super::{
    HashMap, SEARCH_WRITE_BATCH_SIZE, SearchDocument, SearchProfile, SearchQuery, driver, invariant, require_changed,
    required_i64, required_text, text,
};
use crate::driver::Db;
use crate::{PhysicalResetReason, TursoStorageError, key::RecordKey};
use cache_core::search::SearchDocumentRef;
use turso_core::{Numeric, Row, Value};

pub(super) const SLOTS_TABLE: &str =
    "CREATE TABLE search_slots (slot INTEGER PRIMARY KEY, profile INTEGER NOT NULL, bucket TEXT NOT NULL)";
pub(super) const ROWS_TABLE: &str = "CREATE TABLE search_rows (slot INTEGER NOT NULL, profile INTEGER NOT NULL, __typename TEXT NOT NULL, id TEXT NOT NULL, search_text TEXT NOT NULL, timestamp_ms INTEGER NOT NULL, source_hash TEXT NOT NULL, PRIMARY KEY (profile, __typename, id))";
pub(super) const BROWSE_INDEX: &str =
    "CREATE INDEX search_rows_browse_idx ON search_rows(slot, timestamp_ms DESC, __typename, id)";

/// Bits of a row id below its slot. A slot holds 2^44 row ids, and slots run
/// from 1 to 2^19 - 1, so every row id is positive.
pub(super) const SLOT_SHIFT: u32 = 44;
const MAX_SLOT: i64 = (1 << (63 - SLOT_SHIFT)) - 1;
const SLOT_SPAN: i64 = 1 << SLOT_SHIFT;

pub(super) const SLOT_GET: &str = "SELECT slot FROM search_slots WHERE profile = ?1 AND bucket = ?2";
const SLOT_INSERT: &str = "INSERT INTO search_slots (slot, profile, bucket) VALUES ((SELECT coalesce(max(slot), 0) + 1 FROM search_slots), ?1, ?2)";
const LAST_ROW: &str =
    "SELECT rowid FROM search_rows WHERE rowid BETWEEN ?1 AND ?2 ORDER BY rowid DESC LIMIT 1";
pub(super) const ROWID: &str = "SELECT rowid FROM search_rows INDEXED BY sqlite_autoindex_search_rows_1 WHERE profile = ? AND __typename = ? AND id = ?";
const EXISTING: &str = "SELECT rowid, profile, __typename, id FROM search_rows INDEXED BY sqlite_autoindex_search_rows_1 WHERE profile = ? AND __typename = ? AND id = ?";
pub(super) const DELETE: &str = "DELETE FROM search_rows WHERE rowid = ?1";
pub(super) const UPSERT_PREFIX: &str = "INSERT OR REPLACE INTO search_rows (rowid, slot, profile, __typename, id, search_text, timestamp_ms, source_hash) VALUES ";
const UPSERT_ROW: &str = "(?, ?, ?, ?, ?, ?, ?, ?)";
pub(super) const LOAD: &str = "SELECT __typename, id, search_text, timestamp_ms, source_hash FROM search_rows WHERE rowid BETWEEN ?1 AND ?2";
pub(super) const BROWSE: &str = "SELECT __typename, id, search_text, timestamp_ms, source_hash FROM search_rows INDEXED BY search_rows_browse_idx WHERE slot = ?1 ORDER BY timestamp_ms DESC, __typename ASC, id ASC LIMIT ?2";
pub(super) const BROWSE_AFTER: &str = "SELECT __typename, id, search_text, timestamp_ms, source_hash FROM search_rows INDEXED BY search_rows_browse_idx WHERE slot = ?1 AND (timestamp_ms < ?2 OR (timestamp_ms = ?2 AND (__typename > ?3 OR (__typename = ?3 AND id > ?4)))) ORDER BY timestamp_ms DESC, __typename ASC, id ASC LIMIT ?5";

/// The stored number of a profile. Stable: it is persisted in every row.
pub(super) const fn profile_code(profile: SearchProfile) -> i64 {
    match profile {
        SearchProfile::QuickAccessV1 => 1,
    }
}

/// The first and last row ids of `slot`.
pub(super) fn slot_range(slot: i64) -> Result<(i64, i64), TursoStorageError> {
    if !(1..=MAX_SLOT).contains(&slot) {
        return Err(invariant());
    }
    let first = slot << SLOT_SHIFT;
    Ok((first, first + (SLOT_SPAN - 1)))
}

/// The slot of a profile bucket, if it has ever held a row.
pub(super) fn find_slot(
    connection: &Db,
    profile: SearchProfile,
    bucket: &str,
) -> Result<Option<i64>, TursoStorageError> {
    let rows = driver::query(
        connection,
        SLOT_GET,
        vec![Value::from_i64(profile_code(profile)), text(bucket)],
    )?;
    match rows.as_slice() {
        [] => Ok(None),
        [row] => {
            let slot = required_i64(row, 0)?;
            slot_range(slot)?;
            Ok(Some(slot))
        }
        _ => Err(invariant()),
    }
}

/// Slots and next row ids used by one write, read from the database once.
#[derive(Default)]
struct Slots {
    by_bucket: HashMap<(i64, String), i64>,
    next_row: HashMap<i64, i64>,
}

impl Slots {
    fn slot(
        &mut self,
        connection: &Db,
        profile: SearchProfile,
        bucket: &str,
    ) -> Result<i64, TursoStorageError> {
        let code = profile_code(profile);
        if let Some(slot) = self.by_bucket.get(&(code, bucket.to_owned())) {
            return Ok(*slot);
        }
        let slot = match find_slot(connection, profile, bucket)? {
            Some(slot) => slot,
            None => {
                require_changed(
                    driver::execute(
                        connection,
                        SLOT_INSERT,
                        vec![Value::from_i64(code), text(bucket)],
                    )?,
                    1,
                )?;
                find_slot(connection, profile, bucket)?.ok_or_else(invariant)?
            }
        };
        self.by_bucket.insert((code, bucket.to_owned()), slot);
        Ok(slot)
    }

    fn next_rowid(&mut self, connection: &Db, slot: i64) -> Result<i64, TursoStorageError> {
        let (first, last) = slot_range(slot)?;
        let next = match self.next_row.get(&slot) {
            Some(next) => *next,
            None => match driver::query(
                connection,
                LAST_ROW,
                vec![Value::from_i64(first), Value::from_i64(last)],
            )?
            .as_slice()
            {
                [] => first,
                [row] => required_i64(row, 0)?.checked_add(1).ok_or_else(invariant)?,
                _ => return Err(invariant()),
            },
        };
        if !(first..=last).contains(&next) {
            return Err(invariant());
        }
        self.next_row.insert(slot, next + 1);
        Ok(next)
    }
}

/// Writes each document's row, replacing the row its key had. A document that
/// stays in its bucket keeps its row id; one that moves gets the next row id
/// of its new bucket, and the replace removes its old row.
pub(super) fn upsert(
    connection: &Db,
    documents: &[(&RecordKey, &SearchDocument)],
) -> Result<(), TursoStorageError> {
    let mut slots = Slots::default();
    for documents in documents.chunks(SEARCH_WRITE_BATCH_SIZE) {
        let existing = existing_rowids(connection, documents)?;
        let values_sql = std::iter::repeat_n(UPSERT_ROW, documents.len())
            .collect::<Vec<_>>()
            .join(", ");
        let mut parameters = Vec::with_capacity(documents.len() * 8);
        for (key, document) in documents {
            let profile = profile_code(document.profile);
            let slot = slots.slot(connection, document.profile, &document.bucket)?;
            let rowid = match existing.get(&(profile, key.typename.clone(), key.id.clone())) {
                Some(rowid) if rowid >> SLOT_SHIFT == slot => *rowid,
                _ => slots.next_rowid(connection, slot)?,
            };
            parameters.push(Value::from_i64(rowid));
            parameters.push(Value::from_i64(slot));
            parameters.push(Value::from_i64(profile));
            parameters.push(text(&key.typename));
            parameters.push(text(&key.id));
            parameters.push(text(&document.search_text));
            parameters.push(Value::from_i64(document.timestamp_ms));
            parameters.push(text(&document.source_hash));
        }
        require_changed(
            driver::execute(
                connection,
                &format!("{UPSERT_PREFIX}{values_sql}"),
                parameters,
            )?,
            i64::try_from(documents.len()).map_err(|_| invariant())?,
        )?;
    }
    Ok(())
}

fn existing_rowids(
    connection: &Db,
    documents: &[(&RecordKey, &SearchDocument)],
) -> Result<HashMap<(i64, String, String), i64>, TursoStorageError> {
    let lookup_sql = std::iter::repeat_n(EXISTING, documents.len())
        .collect::<Vec<_>>()
        .join(" UNION ALL ");
    let mut parameters = Vec::with_capacity(documents.len() * 3);
    for (key, document) in documents {
        parameters.push(Value::from_i64(profile_code(document.profile)));
        parameters.push(text(&key.typename));
        parameters.push(text(&key.id));
    }
    driver::query(connection, &lookup_sql, parameters)?
        .iter()
        .map(|row| {
            Ok((
                (
                    required_i64(row, 1)?,
                    required_text(row, 2)?,
                    required_text(row, 3)?,
                ),
                required_i64(row, 0)?,
            ))
        })
        .collect()
}

/// A browse row of `bucket` as a document.
pub(super) fn parse_row(
    row: &[Value],
    profile: SearchProfile,
    bucket: &str,
) -> Result<SearchDocument, TursoStorageError> {
    if row.len() != 5 {
        return Err(invariant());
    }
    let key = RecordKey {
        typename: required_text(row, 0)?,
        id: required_text(row, 1)?,
    }
    .into_entity()?;
    Ok(SearchDocument {
        profile,
        record_key: key,
        bucket: bucket.to_owned(),
        search_text: required_text(row, 2)?,
        timestamp_ms: required_i64(row, 3)?,
        source_hash: required_text(row, 4)?,
    })
}

pub(super) fn visit_row(
    row: &Row,
    profile: SearchProfile,
    bucket: &str,
    query: &SearchQuery,
    key_buffer: &mut String,
    visit: &mut impl FnMut(SearchDocumentRef<'_>),
) -> Result<(), TursoStorageError> {
    let mut values = row.get_values();
    let (
        Some(Value::Text(typename)),
        Some(Value::Text(id)),
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
        bucket,
        search_text: search_text.as_str(),
        timestamp_ms: *timestamp_ms,
        source_hash: source_hash.as_str(),
    });
    Ok(())
}

/// Every row of one slot; [`visit_row`] applies the query.
pub(super) fn statement(slot: i64) -> Result<(String, driver::Values), TursoStorageError> {
    let (first, last) = slot_range(slot)?;
    Ok((
        LOAD.to_owned(),
        vec![Value::from_i64(first), Value::from_i64(last)],
    ))
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

/// `base`, whose first two parameters are a slot's first and last row ids,
/// with the query's tokens as LIKE filters on `search_text`.
pub(super) fn statement_with_base(
    base: &str,
    slot: i64,
    query: &SearchQuery,
) -> Result<(String, driver::Values), TursoStorageError> {
    let (first, last) = slot_range(slot)?;
    let mut sql = base.to_owned();
    let mut values = vec![Value::from_i64(first), Value::from_i64(last)];
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
    Ok((sql, values))
}
