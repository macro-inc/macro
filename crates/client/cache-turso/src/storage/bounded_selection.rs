//! Speculative sort-index windows for partition filters. Every partition of a
//! profile shares the sort index, so one window tests each candidate against
//! the predicate of its own partition. A window that
//! cannot prove a full page reads on from its last candidate, never returning
//! the ones before again, by an amount sized from the hit rate it saw, up to
//! `MAX_CANDIDATES` per fact source. Filters sparser than that fall back to the
//! set-based SQL plan. An authority candidate's predicate is tested in Rust on
//! the facts blob of its document, so that window serves a predicate of any
//! depth; the optimistic window tests predicates in SQL and is refused for
//! one deeper than the expression limit. Optimistic facts hold only pending local writes, so
//! their window runs out long before the cap; when the snapshot holds none,
//! neither that window nor the per-candidate shadow probe runs. Both plans run
//! inside the caller's read transaction over the same snapshot. Inside a tie a
//! continuation seeks to the tie's value and steps over the index entries of
//! the tied candidates already read, at a fraction of a returned candidate's
//! cost each.

use super::*;
use predicate_index::{IndexQuery, PartitionPredicate, ReferenceHit};

const MIN_CANDIDATES: usize = 64;
const CANDIDATES_PER_RESULT: usize = 2;
/// The widest window tried before the set-based plan. At a few microseconds per
/// candidate this stays well under what the set-based plan costs on a large
/// cache, and it keeps a sparse filter from walking the whole sort index.
const MAX_CANDIDATES: usize = 4_096;
/// The most a window's total grows in one step, so one unlucky estimate cannot
/// jump straight to the cap.
const MAX_GROWTH: usize = 8;

pub(super) fn select(
    connection: &Db,
    query: &ValidatedIndexQuery,
    excluded_optimistic: &[i64],
    include_sort: bool,
) -> Result<driver::Rows, TursoStorageError> {
    if let Some(hits) = try_select(connection, query, excluded_optimistic)? {
        return Ok(hits
            .into_iter()
            .map(|hit| {
                let mut row = vec![text(hit.record_key.as_str())];
                if include_sort {
                    row.push(Value::from_i64(hit.sort_value));
                }
                row
            })
            .collect());
    }
    let (sql, parameters) = if include_sort {
        compile_predicate_selection(query, excluded_optimistic, true)
    } else {
        compile_predicate_sql(query)
    };
    driver::query(connection, &sql, parameters)
}

fn candidate_budget(query: &IndexQuery) -> usize {
    (usize::from(query.limit) * CANDIDATES_PER_RESULT).clamp(MIN_CANDIDATES, MAX_CANDIDATES)
}

/// The next window after `budget` candidates found `hits` matches short of a
/// page: enough, at the hit rate seen so far, for the page and a quarter more,
/// growing at least twofold and at most `MAX_GROWTH`-fold. `None` when even
/// the cap cannot hold a page at that rate, so the set-based plan runs now
/// instead of after another wasted window.
fn next_budget(budget: usize, hits: usize, limit: usize) -> Option<usize> {
    if budget >= MAX_CANDIDATES {
        return None;
    }
    if hits > 0 && budget.saturating_mul(limit) / hits > MAX_CANDIDATES {
        return None;
    }
    let wanted = budget
        .saturating_mul(limit.saturating_mul(5))
        .div_ceil(hits.max(1).saturating_mul(4));
    Some(
        wanted
            .clamp(budget.saturating_mul(2), budget.saturating_mul(MAX_GROWTH))
            .min(MAX_CANDIDATES),
    )
}

/// Only a positive conjunct constrains the candidate window. Keep the inclusive
/// timestamp boundary; the full predicate still handles record-key ties exactly.
fn cursor_bound(expr: &PredicateExpr, query: &IndexQuery) -> Option<i64> {
    match expr {
        PredicateExpr::After {
            attribute,
            value,
            direction,
            ..
        } if attribute == &query.sort_attribute && direction == &query.sort_direction => {
            Some(*value)
        }
        PredicateExpr::And(left, right) => {
            match (cursor_bound(left, query), cursor_bound(right, query)) {
                (Some(left), Some(right)) => Some(match query.sort_direction {
                    SortDirection::Asc => left.max(right),
                    SortDirection::Desc => left.min(right),
                }),
                (left, right) => left.or(right),
            }
        }
        _ => None,
    }
}

/// The partitions a query can match: one whose predicate matches nothing
/// adds no candidates.
fn searched_partitions(query: &IndexQuery) -> impl Iterator<Item = &PartitionPredicate> {
    query
        .partitions
        .iter()
        .filter(|partition| !matches!(partition.predicate, PredicateExpr::None))
}

/// The cursor bound every searched partition shares: the loosest of theirs,
/// or none when any partition has none. Each candidate still meets its own
/// partition's full predicate.
fn window_bound(query: &IndexQuery) -> Option<i64> {
    let mut bound: Option<i64> = None;
    for partition in searched_partitions(query) {
        let value = cursor_bound(&partition.predicate, query)?;
        bound = Some(bound.map_or(value, |bound| match query.sort_direction {
            SortDirection::Asc => bound.min(value),
            SortDirection::Desc => bound.max(value),
        }));
    }
    bound
}

/// `terms` joined by `OR` as a balanced tree, so the SQL nests by the
/// logarithm of the partition count instead of the count.
fn balanced_or(terms: &[String]) -> String {
    match terms {
        [] => "0".to_owned(),
        [term] => term.clone(),
        _ => {
            let (left, right) = terms.split_at(terms.len() / 2);
            format!("({} OR {})", balanced_or(left), balanced_or(right))
        }
    }
}

/// A window's last candidate in index order: its sort value and document id.
#[derive(Clone, Copy)]
struct Position {
    value: i64,
    document: i64,
}

/// `budget` candidates in index order, starting after `after` when a previous
/// window of the same source already read up to it. `pending` says whether the
/// snapshot holds any optimistic document; without one no authority candidate
/// can be shadowed, so the per-candidate shadow probe is left out.
fn candidate_sql(
    query: &IndexQuery,
    source: conjunction::FactSource,
    excluded_optimistic: &[i64],
    after: Option<Position>,
    budget: usize,
    pending: bool,
) -> (String, Vec<Value>) {
    let (facts, index, documents) = match source {
        conjunction::FactSource::Authority => {
            ("sort_facts", "sort_facts_lookup_idx", "index_documents")
        }
        conjunction::FactSource::Optimistic => (
            "optimistic_sort_facts",
            "optimistic_sort_facts_lookup_idx",
            "optimistic_index_documents",
        ),
    };
    let direction = match query.sort_direction {
        SortDirection::Asc => "ASC",
        SortDirection::Desc => "DESC",
    };
    let mut parameters = vec![text(query.sort_attribute.as_str())];
    // A continuation lies inside the cursor's range already, so its position
    // replaces the cursor bound: the value range keeps the index seek, and the
    // document id skips the part of the tie the previous window read.
    let boundary = if let Some(after) = after {
        parameters.extend([
            Value::from_i64(after.value),
            Value::from_i64(after.value),
            Value::from_i64(after.document),
        ]);
        match query.sort_direction {
            SortDirection::Asc => " AND value >= ? AND (value > ? OR document_id > ?)",
            SortDirection::Desc => " AND value <= ? AND (value < ? OR document_id < ?)",
        }
    } else if let Some(value) = window_bound(query) {
        parameters.push(Value::from_i64(value));
        match query.sort_direction {
            SortDirection::Asc => " AND value >= ?",
            SortDirection::Desc => " AND value <= ?",
        }
    } else {
        ""
    };
    parameters.extend([
        Value::from_i64(i64::try_from(budget).unwrap_or(i64::MAX)),
        text(query.profile.token().as_str()),
    ]);
    let shadow = match source {
        // Any shadow suppresses authority, even a deleted, uncertain, or moved one.
        conjunction::FactSource::Authority if !pending => String::new(),
        conjunction::FactSource::Authority => " AND NOT EXISTS (SELECT 1 FROM optimistic_index_documents AS o WHERE o.record_key = d.record_key)".to_owned(),
        conjunction::FactSource::Optimistic if !excluded_optimistic.is_empty() => {
            parameters.extend(excluded_optimistic.iter().copied().map(Value::from_i64));
            format!(" AND d.id NOT IN ({})", vec!["?"; excluded_optimistic.len()].join(", "))
        }
        conjunction::FactSource::Optimistic => String::new(),
    };
    // Bound BEFORE scope/predicate probes. A sparse query cannot turn this
    // speculation into a full-index walk. Ordering document_id with value lets
    // Turso walk the existing index without sorting the corpus. Record-key
    // ordering is resolved only after proving the entire cutoff tie is present.
    let candidates = format!(
        "WITH candidates AS MATERIALIZED (SELECT document_id, value FROM {facts} INDEXED BY {index} WHERE attribute = ?{boundary} ORDER BY value {direction}, document_id {direction} LIMIT ?)"
    );
    let sql = match source {
        // An authority candidate in scope brings its facts blob, and its own
        // partition's predicate is tested on it in Rust: one row read instead
        // of a fact-table seek per fact the predicate names. A join, unlike a
        // correlated subquery, opens the facts cursor once per statement. Every
        // candidate seeks its facts row, but the blob column is read only
        // behind the CASE, for a candidate in scope.
        conjunction::FactSource::Authority => {
            let partitions = searched_partitions(query)
                .map(|partition| {
                    parameters.push(text(partition.partition.as_str()));
                    "?"
                })
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "{candidates} SELECT d.record_key, s.value, s.document_id, d.partition, CASE WHEN d.profile = ? AND d.state = 0{shadow} AND d.partition IN ({partitions}) THEN f.facts END FROM candidates AS s CROSS JOIN {documents} AS d ON d.id = s.document_id LEFT JOIN index_document_facts AS f ON f.document_id = d.id"
            )
        }
        conjunction::FactSource::Optimistic => {
            let partitions = searched_partitions(query)
                .map(|partition| {
                    parameters.push(text(partition.partition.as_str()));
                    let predicate =
                        conjunction::condition(&partition.predicate, source, &mut parameters);
                    format!("(d.partition = ? AND ({predicate}))")
                })
                .collect::<Vec<_>>();
            let partitions = balanced_or(&partitions);
            format!(
                "{candidates} SELECT d.record_key, s.value, s.document_id, NULL, CASE WHEN d.profile = ? AND d.state = 0{shadow} AND ({partitions}) THEN 1 ELSE 0 END FROM candidates AS s CROSS JOIN {documents} AS d ON d.id = s.document_id"
            )
        }
    };
    (sql, parameters)
}

/// Whether a window row is a hit: the optimistic window's SQL decided it, and
/// an authority row in scope carries the facts its partition's predicate is
/// tested on.
fn row_matches(
    query: &IndexQuery,
    source: conjunction::FactSource,
    record_key: &str,
    row: &WindowRow<'_>,
    facts: &mut facts_blob::Facts<'static>,
) -> Result<bool, TursoStorageError> {
    match source {
        conjunction::FactSource::Optimistic => Ok(row_i64(row[4])? == 1),
        conjunction::FactSource::Authority => {
            let blob = match row[4] {
                Value::Null => return Ok(false),
                Value::Blob(blob) => &blob[..],
                _ => return Err(invariant()),
            };
            let partition = match row[3] {
                Value::Text(partition) => partition.as_str(),
                _ => return Err(invariant()),
            };
            let predicate = &searched_partitions(query)
                .find(|candidate| candidate.partition.as_str() == partition)
                .ok_or_else(invariant)?
                .predicate;
            // Decodes into the window's buffers, so a row allocates nothing.
            let mut decoded: facts_blob::Facts<'_> = std::mem::take(facts);
            let matched = facts_blob::decode_into(blob, &mut decoded)
                .map(|()| predicate_index::matches_facts(&decoded, record_key, predicate));
            *facts = decoded.recycle();
            matched.ok_or_else(invariant)
        }
    }
}

/// A window row's columns, borrowed from the statement: record key, sort
/// value, document id, partition, and the facts blob or optimistic verdict.
type WindowRow<'a> = [&'a Value; 5];

fn row_i64(value: &Value) -> Result<i64, TursoStorageError> {
    match value {
        Value::Numeric(Numeric::Integer(value)) => Ok(*value),
        _ => Err(TursoStorageError::reset(PhysicalResetReason::Corruption)),
    }
}

fn row_text(value: &Value) -> Result<&str, TursoStorageError> {
    match value {
        Value::Text(value) => Ok(value.as_str()),
        _ => Err(TursoStorageError::reset(PhysicalResetReason::Corruption)),
    }
}

/// One fact source's candidates read so far, in index order.
struct Window {
    source: conjunction::FactSource,
    /// Candidates read, across every continuation.
    read: usize,
    /// The last read returned fewer rows than it asked for: no more candidates.
    exhausted: bool,
    last: Option<Position>,
    hits: Vec<ReferenceHit>,
    /// Decode buffers reused across rows.
    facts: facts_blob::Facts<'static>,
}

impl Window {
    fn new(source: conjunction::FactSource) -> Self {
        Self {
            source,
            read: 0,
            exhausted: false,
            last: None,
            hits: Vec::new(),
            facts: facts_blob::Facts::default(),
        }
    }

    /// Reads the next `count` candidates after the last one read. Returns
    /// false, reading nothing, when Turso refuses the SQL: it joins every
    /// partition's predicate into one expression, which can nest deeper than
    /// Turso parses.
    fn extend(
        &mut self,
        connection: &Db,
        query: &IndexQuery,
        excluded_optimistic: &[i64],
        count: usize,
        pending: bool,
    ) -> Result<bool, TursoStorageError> {
        let (sql, parameters) = candidate_sql(
            query,
            self.source,
            excluded_optimistic,
            self.last,
            count,
            pending,
        );
        let Some(mut statement) = driver::prepare_unless_refused(connection, &sql)? else {
            return Ok(false);
        };
        // Each row is tested as it is read, so at most one candidate's facts
        // blob is held at a time however large the window.
        let mut read = 0;
        driver::query_each_prepared(&mut statement, parameters, |row| {
            read += 1;
            if row.len() != 5 {
                return Err(invariant());
            }
            self.take(
                query,
                &[
                    row.get_value(0),
                    row.get_value(1),
                    row.get_value(2),
                    row.get_value(3),
                    row.get_value(4),
                ],
            )
        })?;
        self.read += read;
        self.exhausted = read < count;
        Ok(true)
    }

    fn take(&mut self, query: &IndexQuery, row: &WindowRow<'_>) -> Result<(), TursoStorageError> {
        let position = Position {
            value: row_i64(row[1])?,
            document: row_i64(row[2])?,
        };
        let later = self.last.is_none_or(|last| {
            let order = (position.value, position.document).cmp(&(last.value, last.document));
            match query.sort_direction {
                SortDirection::Asc => order.is_gt(),
                SortDirection::Desc => order.is_lt(),
            }
        });
        if later {
            self.last = Some(position);
        }
        let record_key = row_text(row[0])?;
        if row_matches(query, self.source, record_key, row, &mut self.facts)? {
            self.hits.push(ReferenceHit {
                record_key: PredicateRecordKey::new(record_key.to_owned())
                    .map_err(|_| invariant())?,
                sort_value: position.value,
            });
        }
        Ok(())
    }

    /// Every candidate up to `cutoff` is read: the window ran out, or its last
    /// candidate lies strictly past the cutoff, so the cutoff's whole tie is in.
    fn proves(&self, cutoff: Option<i64>, direction: &SortDirection) -> bool {
        self.exhausted
            || cutoff
                .zip(self.last)
                .is_some_and(|(cutoff, last)| match direction {
                    SortDirection::Asc => last.value > cutoff,
                    SortDirection::Desc => last.value < cutoff,
                })
    }
}

/// Whether the snapshot holds any optimistic document, of any profile.
fn has_optimistic_documents(connection: &Db) -> Result<bool, TursoStorageError> {
    let rows = driver::query(
        connection,
        "SELECT EXISTS (SELECT 1 FROM optimistic_index_documents)",
        Vec::new(),
    )?;
    match rows.as_slice() {
        [row] => Ok(required_i64(row, 0)? != 0),
        _ => Err(invariant()),
    }
}

/// Reads both fact sources' windows, continuing any that cannot yet prove the
/// page past the candidates it already read, until every window is exhausted
/// or reaches past the page's cutoff.
fn try_select(
    connection: &Db,
    query: &ValidatedIndexQuery,
    excluded_optimistic: &[i64],
) -> Result<Option<Vec<ReferenceHit>>, TursoStorageError> {
    let query = query.as_query();
    if searched_partitions(query).next().is_none() {
        return Ok(None);
    }
    let limit = usize::from(query.limit);
    let mut budget = candidate_budget(query);
    // Optimistic documents exist only while local writes are pending. With
    // none in this snapshot, nothing shadows authority and the optimistic
    // window would read nothing, so only the authority window runs.
    let pending = has_optimistic_documents(connection)?;
    let mut windows = vec![Window::new(conjunction::FactSource::Authority)];
    if pending {
        windows.push(Window::new(conjunction::FactSource::Optimistic));
    }
    // SQL Turso refuses takes the set-based plan, which compiles each
    // partition on its own.
    for window in &mut windows {
        if !window.extend(connection, query, excluded_optimistic, budget, pending)? {
            return Ok(None);
        }
    }
    loop {
        let mut hits = windows
            .iter()
            .flat_map(|window| window.hits.iter())
            .collect::<Vec<_>>();
        hits.sort_by(|left, right| {
            let value = match query.sort_direction {
                SortDirection::Asc => left.sort_value.cmp(&right.sort_value),
                SortDirection::Desc => right.sort_value.cmp(&left.sort_value),
            };
            value.then_with(|| match query.tie_break_direction {
                SortDirection::Asc => left.record_key.cmp(&right.record_key),
                SortDirection::Desc => right.record_key.cmp(&left.record_key),
            })
        });
        let cutoff = hits.get(limit - 1).map(|hit| hit.sort_value);
        if windows
            .iter()
            .all(|window| window.proves(cutoff, &query.sort_direction))
        {
            return Ok(Some(hits.into_iter().take(limit).cloned().collect()));
        }
        // A window short of a full page sizes the next one by its hit rate; one
        // that holds a page but ends inside the cutoff's tie only doubles, since
        // its hit rate says nothing about how wide the tie is.
        let next = if cutoff.is_some() {
            (budget < MAX_CANDIDATES).then(|| budget.saturating_mul(2).min(MAX_CANDIDATES))
        } else {
            next_budget(budget, hits.len(), limit)
        };
        let Some(next) = next else {
            return Ok(None);
        };
        budget = next;
        for window in &mut windows {
            if !window.proves(cutoff, &query.sort_direction) {
                let count = budget.saturating_sub(window.read);
                if !window.extend(connection, query, excluded_optimistic, count, pending)? {
                    return Ok(None);
                }
            }
        }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;
