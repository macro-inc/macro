//! Indexed name-first reads over the existing owned predicate projection.
//! Query planning may change work, never eligibility, ordering or completeness.
mod sql;
#[cfg(all(test, not(target_arch = "wasm32")))]
mod test;

use super::*;
use cache_core::people::name_search::{
    self as names_search, NameSearch, NameStage, prefix_end, projection as names,
    reader::{NameSearchRead, ScanStart},
};
use cache_core::people::sql::projection as people;
use sql::{Bounds, Params, Seed};
use std::collections::BTreeSet;

const PROBE_LIMIT: usize = 129;
const RANK_BUDGET: usize = 4096;

pub(super) fn read(
    connection: &Db,
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
    connection: &Db,
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
    connection: &Db,
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
        let matching = if matches!(stage, NameStage::Contains | NameStage::Address) {
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
    connection: &Db,
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
    connection: &Db,
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

/// Walk one stage in window order and stop once nothing later can enter the
/// window. Without a list priority that is the default and current-epoch rank
/// streams. With one, each group walks its lists' scoped rank streams in turn,
/// then people in no group walk the plain streams. False when a stream exceeded
/// its work budget; the caller then reads the complete matching stream.
fn ordered(
    connection: &Db,
    read: &mut NameSearchRead<'_>,
    stage: NameStage,
) -> Result<bool, TursoStorageError> {
    let (override_attribute, list_override_attribute) = if read.substitutes_dm() {
        (names::COMMAND_RANK, names::LIST_COMMAND_RANK)
    } else {
        (names::USER_RANK, names::LIST_USER_RANK)
    };
    let groups = read.list_groups().to_vec();
    let mut scanned = BTreeSet::new();
    for (group, keys) in groups.iter().enumerate() {
        let group = u8::try_from(group).map_err(|_| invariant())?;
        if read.skip_group(stage, group) {
            return Ok(true);
        }
        for key in keys {
            if !scanned.insert(key.as_str()) {
                continue;
            }
            let prefix = names_search::list_prefix(key);
            let scan = RankScan {
                group,
                default_attribute: names::LIST_DEFAULT_RANK,
                override_attribute: list_override_attribute,
                prefix: &prefix,
                excluded_lists: &[],
            };
            if !ordered_scan(connection, read, stage, &scan)? {
                return Ok(false);
            }
        }
    }
    let group = read.unlisted_group();
    if read.request().only_listed || read.skip_group(stage, group) {
        return Ok(true);
    }
    let excluded_lists = scanned.into_iter().collect::<Vec<_>>();
    let scan = RankScan {
        group,
        default_attribute: names::DEFAULT_RANK,
        override_attribute,
        prefix: &[],
        excluded_lists: &excluded_lists,
    };
    ordered_scan(connection, read, stage, &scan)
}

/// One group's rank streams: keys under `prefix` in the default stream, and
/// under `prefix` then the epoch in the current-epoch stream. Members of
/// `excluded_lists` belong to an earlier group and are left out.
struct RankScan<'a> {
    group: u8,
    default_attribute: &'static str,
    override_attribute: &'static str,
    prefix: &'a [u8],
    excluded_lists: &'a [&'a str],
}

fn ordered_scan(
    connection: &Db,
    read: &mut NameSearchRead<'_>,
    stage: NameStage,
    scan: &RankScan<'_>,
) -> Result<bool, TursoStorageError> {
    let after = match read.scan_start(stage, scan.group) {
        ScanStart::Skip => return Ok(true),
        ScanStart::First => None,
        ScanStart::After(key) => Some(key),
    };
    let epoch = read.epoch();
    for (attribute, prefix) in [
        (scan.default_attribute, scan.prefix.to_vec()),
        (
            scan.override_attribute,
            [scan.prefix, epoch.as_bytes().as_slice()].concat(),
        ),
    ] {
        let mut p = Params::default();
        let attr = p.bind(text(attribute));
        let low = p.bind(Value::from_blob(prefix.clone()));
        let mut range = format!("rank.attribute={attr} AND rank.value>={low}");
        if let Some(end) = prefix_end(&prefix) {
            let high = p.bind(Value::from_blob(end));
            range.push_str(&format!(" AND rank.value<{high}"));
        }
        if let Some(after) = &after {
            let after = p.bind(Value::from_blob([prefix.as_slice(), after].concat()));
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
        if attribute == scan.default_attribute {
            let epoch_param = p.bind(Value::from_blob(epoch.as_bytes().to_vec()));
            range.push_str(&format!(" AND NOT EXISTS (SELECT 1 FROM exact_facts current INDEXED BY sqlite_autoindex_exact_facts_1 WHERE current.document_id=d.id AND current.attribute='{}' AND current.value={epoch_param})",names::CONTEXT_EPOCH));
        }
        if !scan.excluded_lists.is_empty() {
            let keys = scan
                .excluded_lists
                .iter()
                .map(|key| p.bind(Value::from_blob(key.as_bytes().to_vec())))
                .collect::<Vec<_>>()
                .join(",");
            range.push_str(&format!(" AND NOT EXISTS (SELECT 1 FROM exact_facts listed INDEXED BY sqlite_autoindex_exact_facts_1 WHERE listed.document_id=d.id AND listed.attribute='{}' AND listed.value IN ({keys}))", names::LIST));
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
            stopped = read.can_stop_at(stage, scan.group, rank);
            Ok(!stopped)
        })?;
        if !complete && !stopped {
            return Ok(false);
        }
    }
    Ok(true)
}
