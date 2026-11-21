//! Speculative sort-index windows for single-partition filters. A window that
//! cannot prove a full page reads on from its last candidate, never returning
//! the ones before again, by an amount sized from the hit rate it saw, up to
//! `MAX_CANDIDATES` per fact source. Filters sparser than that fall back to the
//! set-based SQL plan. Optimistic facts hold only pending local writes, so
//! their window runs out long before the cap. Both plans run inside the
//! caller's read transaction over the same snapshot. Inside a tie a
//! continuation seeks to the tie's value and steps over the index entries of
//! the tied candidates already read, at a fraction of a returned candidate's
//! cost each.

use super::*;
use predicate_index::{IndexQuery, ReferenceHit};

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

/// A window's last candidate in index order: its sort value and document id.
#[derive(Clone, Copy)]
struct Position {
    value: i64,
    document: i64,
}

/// `budget` candidates in index order, starting after `after` when a previous
/// window of the same source already read up to it.
fn candidate_sql(
    query: &IndexQuery,
    source: conjunction::FactSource,
    excluded_optimistic: &[i64],
    after: Option<Position>,
    budget: usize,
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
    } else if let Some(value) = cursor_bound(&query.partitions[0].predicate, query) {
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
        text(query.partitions[0].partition.as_str()),
    ]);
    let shadow = match source {
        // Any shadow suppresses authority, even a deleted, uncertain, or moved one.
        conjunction::FactSource::Authority => " AND NOT EXISTS (SELECT 1 FROM optimistic_index_documents AS o WHERE o.record_key = d.record_key)".to_owned(),
        conjunction::FactSource::Optimistic if !excluded_optimistic.is_empty() => {
            parameters.extend(excluded_optimistic.iter().copied().map(Value::from_i64));
            format!(" AND d.id NOT IN ({})", vec!["?"; excluded_optimistic.len()].join(", "))
        }
        conjunction::FactSource::Optimistic => String::new(),
    };
    let predicate = conjunction::condition(&query.partitions[0].predicate, source, &mut parameters);
    // Bound BEFORE scope/predicate probes. A sparse query cannot turn this
    // speculation into a full-index walk. Ordering document_id with value lets
    // Turso walk the existing index without sorting the corpus. Record-key
    // ordering is resolved only after proving the entire cutoff tie is present.
    let sql = format!(
        "WITH candidates AS MATERIALIZED (SELECT document_id, value FROM {facts} INDEXED BY {index} WHERE attribute = ?{boundary} ORDER BY value {direction}, document_id {direction} LIMIT ?) SELECT d.record_key, s.value, s.document_id, CASE WHEN d.profile = ? AND d.partition = ? AND d.state = 0{shadow} AND ({predicate}) THEN 1 ELSE 0 END FROM candidates AS s CROSS JOIN {documents} AS d ON d.id = s.document_id"
    );
    (sql, parameters)
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
}

impl Window {
    fn new(source: conjunction::FactSource) -> Self {
        Self {
            source,
            read: 0,
            exhausted: false,
            last: None,
            hits: Vec::new(),
        }
    }

    /// Reads the next `count` candidates after the last one read.
    fn extend(
        &mut self,
        connection: &Db,
        query: &IndexQuery,
        excluded_optimistic: &[i64],
        count: usize,
    ) -> Result<(), TursoStorageError> {
        let (sql, parameters) =
            candidate_sql(query, self.source, excluded_optimistic, self.last, count);
        let rows = driver::query(connection, &sql, parameters)?;
        self.read += rows.len();
        self.exhausted = rows.len() < count;
        for row in rows {
            if row.len() != 4 {
                return Err(invariant());
            }
            let position = Position {
                value: required_i64(&row, 1)?,
                document: required_i64(&row, 2)?,
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
            if required_i64(&row, 3)? == 1 {
                self.hits.push(ReferenceHit {
                    record_key: PredicateRecordKey::new(required_text(&row, 0)?)
                        .map_err(|_| invariant())?,
                    sort_value: position.value,
                });
            }
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

/// Reads both fact sources' windows, continuing any that cannot yet prove the
/// page past the candidates it already read, until every window is exhausted
/// or reaches past the page's cutoff.
fn try_select(
    connection: &Db,
    query: &ValidatedIndexQuery,
    excluded_optimistic: &[i64],
) -> Result<Option<Vec<ReferenceHit>>, TursoStorageError> {
    let query = query.as_query();
    if query.partitions.len() != 1 || matches!(query.partitions[0].predicate, PredicateExpr::None) {
        return Ok(None);
    }
    let limit = usize::from(query.limit);
    let mut budget = candidate_budget(query);
    let mut windows = [
        Window::new(conjunction::FactSource::Authority),
        Window::new(conjunction::FactSource::Optimistic),
    ];
    for window in &mut windows {
        window.extend(connection, query, excluded_optimistic, budget)?;
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
                window.extend(connection, query, excluded_optimistic, count)?;
            }
        }
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;
