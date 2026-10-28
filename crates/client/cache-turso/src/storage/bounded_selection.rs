//! Speculative sort-index windows for dense, single-partition filters. Sparse
//! filters and truncated timestamp ties fall back to the set-based SQL plan.
//! Both plans run inside the caller's read transaction over the same snapshot.

use super::*;
use predicate_index::{IndexQuery, ReferenceHit};

const MIN_CANDIDATES: usize = 64;
const CANDIDATES_PER_RESULT: usize = 2;

pub(super) fn select(
    connection: &Arc<Connection>,
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
    (usize::from(query.limit) * CANDIDATES_PER_RESULT).max(MIN_CANDIDATES)
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

fn candidate_sql(
    query: &IndexQuery,
    source: conjunction::FactSource,
    excluded_optimistic: &[i64],
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
    let boundary = if let Some(value) = cursor_bound(&query.partitions[0].predicate, query) {
        parameters.push(Value::from_i64(value));
        match query.sort_direction {
            SortDirection::Asc => " AND value >= ?",
            SortDirection::Desc => " AND value <= ?",
        }
    } else {
        ""
    };
    parameters.extend([
        Value::from_i64(candidate_budget(query) as i64),
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
        "WITH candidates AS MATERIALIZED (SELECT document_id, value FROM {facts} INDEXED BY {index} WHERE attribute = ?{boundary} ORDER BY value {direction}, document_id {direction} LIMIT ?) SELECT d.record_key, s.value, CASE WHEN d.profile = ? AND d.partition = ? AND d.state = 0{shadow} AND ({predicate}) THEN 1 ELSE 0 END FROM candidates AS s CROSS JOIN {documents} AS d ON d.id = s.document_id"
    );
    (sql, parameters)
}

struct Window {
    exhausted: bool,
    frontier: Option<i64>,
}

fn try_select(
    connection: &Arc<Connection>,
    query: &ValidatedIndexQuery,
    excluded_optimistic: &[i64],
) -> Result<Option<Vec<ReferenceHit>>, TursoStorageError> {
    let query = query.as_query();
    if query.partitions.len() != 1 || matches!(query.partitions[0].predicate, PredicateExpr::None) {
        return Ok(None);
    }
    let mut hits = Vec::new();
    let mut windows = Vec::new();
    for source in [
        conjunction::FactSource::Authority,
        conjunction::FactSource::Optimistic,
    ] {
        let (sql, parameters) = candidate_sql(query, source, excluded_optimistic);
        let rows = driver::query(connection, &sql, parameters)?;
        let mut window = Window {
            exhausted: rows.len() < candidate_budget(query),
            frontier: None,
        };
        for row in rows {
            if row.len() != 3 {
                return Err(invariant());
            }
            let sort_value = required_i64(&row, 1)?;
            window.frontier = Some(match window.frontier {
                None => sort_value,
                Some(previous) => match query.sort_direction {
                    SortDirection::Asc => previous.max(sort_value),
                    SortDirection::Desc => previous.min(sort_value),
                },
            });
            if required_i64(&row, 2)? == 1 {
                hits.push(ReferenceHit {
                    record_key: PredicateRecordKey::new(required_text(&row, 0)?)
                        .map_err(|_| invariant())?,
                    sort_value,
                });
            }
        }
        windows.push(window);
    }
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
    let limit = usize::from(query.limit);
    let cutoff = hits.get(limit - 1).map(|hit| hit.sort_value);
    for window in windows {
        if window.exhausted {
            continue;
        }
        let covered = cutoff
            .zip(window.frontier)
            .is_some_and(|(cutoff, frontier)| match query.sort_direction {
                SortDirection::Asc => frontier > cutoff,
                SortDirection::Desc => frontier < cutoff,
            });
        if !covered {
            return Ok(None);
        }
    }
    hits.truncate(limit);
    Ok(Some(hits))
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;
