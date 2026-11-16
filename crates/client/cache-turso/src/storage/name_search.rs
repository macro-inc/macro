//! Indexed name-first reads over the existing owned predicate projection.
//! Query planning may change work, never eligibility, ordering or completeness.
mod sql;
#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;

use super::*;
use cache_core::people::name_search::{
    NameSearch, NameStage, prefix_end, projection as names, reader::NameSearchRead,
};
use cache_core::people::sql::projection as people;
use sql::{Bounds, Params, Seed};

const PROBE_LIMIT: usize = 129;
const RANK_BUDGET: usize = 4096;

pub(super) fn read(
    connection: &Arc<Connection>,
    read: &mut NameSearchRead<'_>,
) -> Result<(), TursoStorageError> {
    driver::read_transaction(connection, || {
        if people_sql::viewer(connection)?.as_deref()
            != Some(read.request().scope.identity.as_str())
        {
            return Err(TursoStorageError::InvalidInput);
        }
        let stamp = driver::query(
            connection,
            "SELECT value FROM meta WHERE key=?",
            vec![text(people_sql::VERSION_KEY)],
        )?;
        if !matches!(stamp.as_slice(),[row] if required_text(row,0)?==people_sql::stamp(Some(&read.request().scope.identity)))
        {
            return Err(TursoStorageError::InvalidInput);
        }
        // Incomplete/oversized SQL facts cannot silently omit a valid name. This
        // is a streaming exception path, never a directory-sized materialization.
        incomplete(connection, read, false)?;
        if read.self_pin() {
            let seed = Seed {
                attribute: "id",
                bounds: Bounds::Equal(read.request().scope.identity.as_bytes().to_vec()),
            };
            candidates(connection, read, None, &seed, false)?;
        }
        for stage in read.stages() {
            if read.skip_stage(stage) {
                break;
            }
            stage_read(connection, read, stage)?;
        }
        let aliases = read.prior_dm_targets();
        if !aliases.is_empty() {
            for dm in aliases {
                let seed = Seed {
                    attribute: names::DM,
                    bounds: Bounds::Equal(
                        [read.epoch().as_bytes().as_slice(), dm.as_bytes().as_slice()].concat(),
                    ),
                };
                let (query, params) = sql::candidate(read, None, &seed, false);
                visit(connection, &query, params, |key, record| {
                    read.note_prior_alias(key, record)
                })?;
            }
            incomplete(connection, read, true)?;
        }
        Ok(())
    })
}
fn incomplete(
    connection: &Arc<Connection>,
    read: &mut NameSearchRead<'_>,
    prior: bool,
) -> Result<(), TursoStorageError> {
    let mut p = Params::default();
    let scope = sql::scope(&mut p, read, false);
    let query = format!(
        "SELECT r.__typename,r.id,r.value FROM index_documents d {} WHERE {scope} AND d.state>0",
        sql::RECORD_JOIN
    );
    visit(connection, &query, p.values, |key, record| {
        if prior {
            read.note_prior_alias(key, record)
        } else {
            read.push(key, record, None)
        }
    })
}
fn stage_read(
    connection: &Arc<Connection>,
    read: &mut NameSearchRead<'_>,
    stage: NameStage,
) -> Result<(), TursoStorageError> {
    let mut seeds = sql::seeds(read, stage);
    let mut smallest = usize::MAX;
    let mut selected = 0;
    let mut selected_ids = Vec::new();
    for (i, seed) in seeds.iter().enumerate() {
        let mut p = Params::default();
        let restriction = seed.restriction(&mut p, "seed");
        let scope = sql::scope(&mut p, read, true);
        let matching = if stage == NameStage::Contains {
            sql::seed_filter(&mut p, read, Some(stage), seed)
        } else {
            "1".into()
        };
        let query = format!(
            "SELECT seed.document_id FROM exact_facts seed INDEXED BY exact_facts_lookup_idx CROSS JOIN index_documents d ON d.id=seed.document_id WHERE {restriction} AND {scope} AND {matching} LIMIT {PROBE_LIMIT}"
        );
        let mut ids = Vec::with_capacity(PROBE_LIMIT);
        driver::query_each(connection, &query, p.values, |row| {
            let Some(Value::Numeric(Numeric::Integer(id))) = row.get_values().next() else {
                return Err(invariant());
            };
            ids.push(*id);
            Ok(())
        })?;
        if ids.len() < smallest {
            smallest = ids.len();
            selected = i;
            selected_ids = ids;
        }
    }
    if seeds.is_empty() {
        return Err(invariant());
    }
    let seed = seeds.swap_remove(selected);
    // Sparse or absent posting sets do not justify a full rank-order scan.
    let ordered = if stage == NameStage::Browse || smallest >= PROBE_LIMIT {
        ordered(connection, read, stage)?
    } else {
        false
    };
    if !ordered && smallest != 0 {
        if smallest < PROBE_LIMIT {
            // These are the complete bounded seed superset, not retained history.
            let mut p = Params::default();
            let ids = selected_ids
                .into_iter()
                .map(|id| p.bind(Value::from_i64(id)))
                .collect::<Vec<_>>()
                .join(",");
            let scope = sql::scope(&mut p, read, true);
            let query = format!(
                "SELECT r.__typename,r.id,r.value FROM index_documents d {} WHERE d.id IN ({ids}) AND {scope}",
                sql::RECORD_JOIN
            );
            visit(connection, &query, p.values, |key, record| {
                read.push(key, record, Some(stage))
            })?;
        } else {
            candidates(
                connection,
                read,
                Some(stage),
                &seed,
                stage == NameStage::WordPrefix,
            )?;
        }
    }
    if stage == NameStage::WordPrefix && !ordered {
        let overflow = Seed {
            attribute: names::WORD_OVERFLOW,
            bounds: Bounds::Equal(b"1".to_vec()),
        };
        candidates(connection, read, Some(stage), &overflow, false)?;
    }
    Ok(())
}
fn candidates(
    connection: &Arc<Connection>,
    read: &mut NameSearchRead<'_>,
    stage: Option<NameStage>,
    seed: &Seed,
    exclude_overflow: bool,
) -> Result<(), TursoStorageError> {
    let (query, params) = sql::candidate(read, stage, seed, exclude_overflow);
    visit(connection, &query, params, |key, record| {
        read.push(key, record, stage)
    })
}
fn visit(
    connection: &Arc<Connection>,
    query: &str,
    params: driver::Values,
    mut row: impl FnMut(&EntityKey<'_>, &Record),
) -> Result<(), TursoStorageError> {
    let mut key_buffer = String::new();
    driver::query_each(connection, query, params, |values| {
        let mut values = values.get_values();
        let (Some(Value::Text(typename)), Some(Value::Text(id)), Some(Value::Blob(blob))) =
            (values.next(), values.next(), values.next())
        else {
            return Err(invariant());
        };
        let key = RecordKey::borrow_entity(typename.as_str(), id.as_str(), &mut key_buffer)?;
        let record = decode_record(blob).map_err(|_| invariant())?;
        row(&key, &record);
        Ok(())
    })
}

fn ordered(
    connection: &Arc<Connection>,
    read: &mut NameSearchRead<'_>,
    stage: NameStage,
) -> Result<bool, TursoStorageError> {
    let override_attr = if read.substitutes_dm() {
        names::COMMAND_RANK
    } else {
        names::USER_RANK
    };
    let epoch = read.epoch();
    for (attribute, prefix) in [
        (names::DEFAULT_RANK, vec![]),
        (override_attr, epoch.as_bytes().to_vec()),
    ] {
        let mut p = Params::default();
        let attr = p.bind(text(attribute));
        let low = p.bind(Value::from_blob(prefix.clone()));
        let mut range = format!("rank.attribute={attr} AND rank.value>={low}");
        if let Some(end) = prefix_end(&prefix) {
            let high = p.bind(Value::from_blob(end));
            range.push_str(&format!(" AND rank.value<{high}"));
        }
        if let Some(after) = read.after_key(stage) {
            let after = p.bind(Value::from_blob([prefix.as_slice(), &after].concat()));
            range.push_str(&format!(" AND rank.value>{after}"));
        }
        // Bound the expensive filtered scan by rank position, including all time
        // ties. Exactly one stable identity key crosses this boundary.
        let boundary = driver::query(
            connection,
            &format!(
                "SELECT rank.value FROM exact_facts rank INDEXED BY exact_facts_lookup_idx WHERE {range} ORDER BY rank.value LIMIT 1 OFFSET {}",
                RANK_BUDGET - 1
            ),
            p.values.clone(),
        )?;
        let complete = boundary.is_empty();
        if let [row] = boundary.as_slice() {
            let end = p.bind(Value::from_blob(required_blob(row, 0)?));
            range.push_str(&format!(" AND rank.value<={end}"));
        } else if !complete {
            return Err(invariant());
        }
        let scope = sql::scope(&mut p, read, true);
        let filter = sql::matches(&mut p, read, stage);
        if attribute == names::DEFAULT_RANK {
            let epoch_param = p.bind(Value::from_blob(epoch.as_bytes().to_vec()));
            range.push_str(&format!(" AND NOT EXISTS (SELECT 1 FROM exact_facts current INDEXED BY sqlite_autoindex_exact_facts_1 WHERE current.document_id=d.id AND current.attribute='{}' AND current.value={epoch_param})",names::CONTEXT_EPOCH));
        }
        let query = format!(
            "SELECT r.__typename,r.id,r.value,rank.value FROM exact_facts rank INDEXED BY exact_facts_lookup_idx CROSS JOIN index_documents d ON d.id=rank.document_id {} WHERE {range} AND {scope} AND {filter} ORDER BY rank.value",
            sql::RECORD_JOIN
        );
        let mut stopped = false;
        let mut key_buffer = String::new();
        driver::query_until(connection, &query, p.values, |row| {
            let mut fields = row.get_values();
            let (
                Some(Value::Text(typename)),
                Some(Value::Text(id)),
                Some(Value::Blob(blob)),
                Some(Value::Blob(rank)),
            ) = (fields.next(), fields.next(), fields.next(), fields.next())
            else {
                return Err(invariant());
            };
            let key = RecordKey::borrow_entity(typename.as_str(), id.as_str(), &mut key_buffer)?;
            let record = decode_record(blob).map_err(|_| invariant())?;
            read.push(&key, &record, Some(stage));
            let rank = rank.get(prefix.len()..).ok_or_else(invariant)?;
            stopped = read.can_stop_at(stage, rank);
            Ok(!stopped)
        })?;
        if !complete && !stopped {
            return Ok(false);
        }
    }
    Ok(true)
}
