//! The GraphQL schema a cache's records were written under, stored beside
//! them, and what opening the cache with another build's schema does to them
//! (`cache_core::schema_change`).
//!
//! The one row holds the schema an engine runs with: the build's schema plus
//! the definitions it removed that kept records may still hold values of.
//! Opening with the build that wrote the row reads nothing else. Another
//! build sorts the change into its tier and applies it in one write
//! transaction, so an interrupted open leaves the cache as it was:
//!
//! - [`Tier::Compatible`] stores the new schema and nothing else.
//! - [`Tier::Types`] drops the records of the changed types with every row
//!   derived from them, takes the overlay off each queued write that wrote one,
//!   and starts the backfill over (it drops the storage generation).
//! - [`Tier::Reset`] drops every record but the identity and authority, by
//!   dropping and creating each table again, and takes the overlay off every
//!   queued write.
//!
//! Queued writes are always kept: their mutations are still sent. Their
//! index shadows are composed again over what is left.

use super::*;
use cache_core::calendar::{CALENDAR_TYPENAME, EVENT_TYPENAME, OCCURRENCE_TYPENAME};
use cache_core::meta::Schema;
use cache_core::normalize::RecordUpdates;
use cache_core::queue::{decode_optimistic_source, encode_optimistic_source};
use cache_core::schema_change::{
    ProjectionInputs, ResetReason, SchemaChange, Tier, decode_stored_schema, encode_stored_schema,
    overlay_fits, retire_overlay, unrecorded_schema,
};

pub(super) const CREATE_TABLE: &str = "CREATE TABLE cache_schema (slot INTEGER PRIMARY KEY, hash TEXT NOT NULL, incoming_hash TEXT NOT NULL, artifact BLOB NOT NULL)";
pub(super) const TABLE: &str = "cache_schema";

const SELECT: &str = "SELECT hash, incoming_hash, artifact FROM cache_schema WHERE slot = 0";
const UPSERT: &str = "INSERT INTO cache_schema (slot, hash, incoming_hash, artifact) VALUES (0, ?1, ?2, ?3) ON CONFLICT (slot) DO UPDATE SET hash = excluded.hash, incoming_hash = excluded.incoming_hash, artifact = excluded.artifact";
const SET_INCOMING: &str = "UPDATE cache_schema SET incoming_hash = ?1 WHERE slot = 0";

/// The incoming hash of a cache that builds with different schemas wrote
/// under one engine. It names no build, so the next open of any build sorts
/// the stored schema against its own, and drops what another build wrote that
/// this one's projections read but it never refreshes.
const SEVERAL_BUILDS: &str = "several-builds";

/// Whether the cache holds a record besides storage's own metadata.
const ANY_RECORD: &str = "SELECT 1 FROM records WHERE __typename <> '__meta' LIMIT 1";
const TYPE_RECORDS_DELETE: &str = "DELETE FROM records WHERE __typename = ?1";
const TYPE_SEARCH_DELETE: &str = "DELETE FROM search_documents WHERE __typename = ?1";
/// A type's index documents, by the `Typename:` prefix of their record keys;
/// their facts cascade.
const TYPE_DOCUMENTS_DELETE: &str =
    "DELETE FROM index_documents WHERE record_key >= ?1 AND record_key < ?2";
/// The record whose loss starts the backfill over (`cache_core::engine`).
const STORAGE_GENERATION_DELETE: &str =
    "DELETE FROM records WHERE __typename = '__meta' AND id = 'storage-generation'";
const LAYER_UPDATE: &str = "UPDATE optimistic_layers SET optimistic_data_json = ?2, normalized_updates = ?3 WHERE mutation_id = ?1";

// Making every document dirty marks them with the one incomplete state, then
// drops their facts, in the same transaction. Contact documents are storage's
// own projection of the contact record alone, so they stay.
const EVERY_DOCUMENT_DIRTY: &str = "UPDATE index_documents SET state = 1 WHERE state = 0 AND substr(record_key, 1, 15) <> 'GraphqlContact:'";
/// The fact tables, each `(document_id, attribute, value)`.
const FACT_TABLES: [&str; 3] = ["exact_facts", "integer_facts", "sort_facts"];
/// The documents whose facts stay when every document but contacts goes
/// dirty, as `d`: contacts, and documents already incomplete.
const DOCUMENTS_KEEPING_FACTS: &str =
    "d.state <> 0 OR substr(d.record_key, 1, 15) = 'GraphqlContact:'";
/// Where the facts a fact table keeps wait while it is created again, within
/// the open's transaction. No column has an affinity, so values go back as
/// they came.
const KEPT_FACTS_PREFIX: &str = "schema_change_kept_";

/// The index's tables derived from records, facts before the documents
/// their foreign keys name; [`DERIVED_STORES`] lists the others.
const DERIVED_TABLES: [&str; 5] = [
    "exact_facts",
    "integer_facts",
    "sort_facts",
    "index_documents",
    "search_documents",
];
/// The tables of queued writes' index shadows, those that name a table
/// before it.
const SHADOW_TABLES: [&str; 5] = [
    "optimistic_exact_facts",
    "optimistic_integer_facts",
    "optimistic_sort_facts",
    "optimistic_uncertain_attributes",
    "optimistic_index_documents",
];
/// The records a reset keeps: the identity binding and the permission
/// authority, which describe the queued writes and the cache's owner rather
/// than data. The storage generation goes, so the backfill starts over.
const KEPT_RECORDS: &str = "SELECT __typename, id, value FROM records WHERE __typename = '__meta' AND id IN ('identity', 'authority')";
const RECORD_COUNT: &str = "SELECT COUNT(*) FROM records";
/// A table's SQL and its indexes', as the file stores them, the table first.
const TABLE_SQL: &str = "SELECT sql FROM sqlite_schema WHERE tbl_name = ?1 AND sql IS NOT NULL ORDER BY type DESC, name ASC";

/// A store of rows derived from records of some types, beside the index:
/// its tables, and how to empty them with the sync state that says what they
/// hold. Dropping any of its types' records empties all of it in the same
/// transaction, since coverage that outlived its rows would read as complete
/// and empty and never refetch. A new store adds itself to
/// [`DERIVED_STORES`], and the fields its rows read to
/// `cache_core::schema_change::ProjectionInputs`' derived inputs.
struct DerivedStore {
    /// The record types its rows derive from.
    typenames: &'static [&'static str],
    /// Its tables, those that name a table before it.
    tables: &'static [&'static str],
    /// Empties its tables and drops its sync state.
    clear: fn(&Db) -> Result<(), TursoStorageError>,
}

/// Every [`DerivedStore`]. The calendar's range rows, coverage and sync
/// state describe its three types together.
const DERIVED_STORES: [DerivedStore; 1] = [DerivedStore {
    typenames: &[OCCURRENCE_TYPENAME, EVENT_TYPENAME, CALENDAR_TYPENAME],
    tables: &calendar::TABLES,
    clear: calendar::clear,
}];

/// What opening a cache with a build's schema did to it.
#[derive(Clone, Debug)]
pub struct SchemaAdoption {
    /// The schema the engine runs with: the build's schema plus the stored
    /// definitions it removed that kept records may still hold values of.
    pub schema: Arc<Schema>,
    /// The tier the change fell into; `None` when the cache already stored
    /// this build's schema, or held no record to sort.
    pub change: Option<Tier>,
    /// Records dropped.
    pub dropped_records: u64,
    /// Index documents of kept records made incomplete, because a dropped
    /// type's values fed them.
    pub incomplete_documents: u64,
    /// Queued writes whose optimistic overlay was taken off.
    pub retired_overlays: u64,
}

impl SchemaAdoption {
    fn unchanged(schema: Arc<Schema>) -> Self {
        Self {
            schema,
            change: None,
            dropped_records: 0,
            incomplete_documents: 0,
            retired_overlays: 0,
        }
    }

    /// The outcome's name for telemetry: `unchanged`, or the tier's.
    #[must_use]
    pub fn outcome(&self) -> &'static str {
        self.change
            .as_ref()
            .map_or("unchanged", <&'static str>::from)
    }

    /// Why every record went, for a reset.
    #[must_use]
    pub fn reset_reason(&self) -> Option<ResetReason> {
        match &self.change {
            Some(Tier::Reset(reason)) => Some(*reason),
            Some(Tier::Compatible | Tier::Types { .. }) | None => None,
        }
    }
}

/// Validates the frozen `cache_schema` table.
pub(super) fn validate_schema(connection: &Db) -> Result<(), TursoStorageError> {
    let column = |name, declared_type, not_null, primary_key_position| ColumnSpec {
        name,
        declared_type,
        not_null,
        default_zero: false,
        primary_key_position,
    };
    validate_table_columns(
        connection,
        TABLE,
        &[
            column("slot", "INTEGER", false, 1),
            column("hash", "TEXT", true, 0),
            column("incoming_hash", "TEXT", true, 0),
            column("artifact", "BLOB", true, 0),
        ],
    )?;
    validate_table_indexes(connection, TABLE, &[])?;
    validate_table_constraints(connection, TABLE, false)?;
    validate_no_foreign_keys(connection, TABLE)
}

/// Brings the stored records and queued writes to `incoming`, whose index
/// projections read `inputs`. `unrecorded` is what wrote a cache that stores
/// no schema, when the host knows better than [`unrecorded_schema`].
pub(super) fn adopt(
    connection: &Db,
    incoming: &Arc<Schema>,
    inputs: &ProjectionInputs,
    unrecorded: Option<Arc<Schema>>,
) -> Result<SchemaAdoption, TursoStorageError> {
    if let Some(row) = load(connection)? {
        if row.hash == incoming.hash() {
            return Ok(SchemaAdoption::unchanged(Arc::clone(incoming)));
        }
        if row.incoming_hash == incoming.hash()
            && let Ok(stored) = decode_stored_schema(&row.artifact)
        {
            return Ok(SchemaAdoption::unchanged(stored));
        }
    }
    driver::write_transaction(connection, || {
        let stored = match load(connection)? {
            Some(row) => decode_stored_schema(&row.artifact).ok(),
            None if driver::query(connection, ANY_RECORD, Vec::new())?.is_empty() => {
                store(connection, incoming, incoming.hash())?;
                return Ok(SchemaAdoption::unchanged(Arc::clone(incoming)));
            }
            None => unrecorded.clone().or_else(unrecorded_schema),
        };
        let change = SchemaChange::classify(stored.as_deref(), incoming, inputs);
        let mut adoption = SchemaAdoption::unchanged(Arc::clone(&change.stored));
        match &change.tier {
            Tier::Compatible => {}
            Tier::Types {
                changed,
                every_document,
            } => {
                adoption.dropped_records = drop_types(connection, changed)?;
                if *every_document {
                    adoption.incomplete_documents = dirty_every_document(connection)?;
                }
                adoption.retired_overlays = retire_overlays(connection, |request, source| {
                    overlay_fits(&change.stored, changed, request, source)
                })?;
                recompose_queued_shadows(connection)?;
                driver::execute(connection, STORAGE_GENERATION_DELETE, Vec::new())?;
            }
            Tier::Reset(_) => {
                adoption.dropped_records = clear_records(connection)?;
                recreate_tables(connection, &SHADOW_TABLES)?;
                adoption.retired_overlays = retire_overlays(connection, |_, _| false)?;
                recompose_queued_shadows(connection)?;
            }
        }
        store(connection, &change.stored, incoming.hash())?;
        adoption.change = Some(change.tier);
        Ok(adoption)
    })
    .map_err(TursoStorageError::initialization)
}

/// Records that a live engine now runs with `merged`, the stored schema with
/// whatever `incoming`, another webview's build, added to it, and that this
/// build writes under it too.
pub(super) fn record(
    connection: &Db,
    merged: &Schema,
    incoming: &Schema,
) -> Result<(), TursoStorageError> {
    driver::write_transaction(connection, || {
        let incoming_hash = match load(connection)? {
            Some(row) if row.incoming_hash != incoming.hash() => SEVERAL_BUILDS,
            Some(_) | None => incoming.hash(),
        };
        store(connection, merged, incoming_hash)
    })
}

/// Drops the records of `changed` record types with every row derived from
/// them. Returns how many records it dropped.
fn drop_types(connection: &Db, changed: &BTreeSet<String>) -> Result<u64, TursoStorageError> {
    let mut dropped = 0_u64;
    for typename in changed {
        let records = driver::execute(connection, TYPE_RECORDS_DELETE, vec![text(typename)])?;
        dropped += u64::try_from(records).map_err(|_| invariant())?;
        driver::execute(connection, TYPE_SEARCH_DELETE, vec![text(typename)])?;
        // `;` follows `:`, which no type name holds.
        driver::execute(
            connection,
            TYPE_DOCUMENTS_DELETE,
            vec![text(&format!("{typename}:")), text(&format!("{typename};"))],
        )?;
    }
    for store in &DERIVED_STORES {
        if changed
            .iter()
            .any(|typename| store.typenames.contains(&typename.as_str()))
        {
            (store.clear)(connection)?;
        }
    }
    Ok(dropped)
}

/// Makes every complete document but contacts' incomplete, without its
/// facts. The facts the other documents keep wait in a table of their own
/// while each fact table is created again: deleting most of a table's rows
/// rewrites every page of it and its indexes.
fn dirty_every_document(connection: &Db) -> Result<u64, TursoStorageError> {
    for table in FACT_TABLES {
        let kept = format!("{KEPT_FACTS_PREFIX}{table}");
        driver::execute(
            connection,
            &format!("CREATE TABLE {kept} (document_id, attribute, value)"),
            Vec::new(),
        )?;
        driver::execute(
            connection,
            &format!(
                "INSERT INTO {kept} (document_id, attribute, value) SELECT f.document_id, f.attribute, f.value FROM index_documents d JOIN {table} f ON f.document_id = d.id WHERE {DOCUMENTS_KEEPING_FACTS}"
            ),
            Vec::new(),
        )?;
    }
    recreate_tables(connection, &FACT_TABLES)?;
    for table in FACT_TABLES {
        let kept = format!("{KEPT_FACTS_PREFIX}{table}");
        driver::execute(
            connection,
            &format!(
                "INSERT INTO {table} (document_id, attribute, value) SELECT document_id, attribute, value FROM {kept}"
            ),
            Vec::new(),
        )?;
        driver::execute(connection, &format!("DROP TABLE {kept}"), Vec::new())?;
    }
    let marked = driver::execute(connection, EVERY_DOCUMENT_DIRTY, Vec::new())?;
    u64::try_from(marked).map_err(|_| invariant())
}

/// Takes the optimistic overlay off each queued write that does not `fit`,
/// keeping its mutation. Returns how many it took off.
fn retire_overlays(
    connection: &Db,
    fits: impl Fn(&MutationRequest, &cache_core::queue::OptimisticSource) -> bool,
) -> Result<u64, TursoStorageError> {
    let mut retired = 0_u64;
    for row in driver::query(connection, QUEUE_SELECT, Vec::new())? {
        let row = parse_queue_row(&row)?;
        let layer = row.optimistic.ok_or_else(invariant)?;
        let mut source =
            decode_optimistic_source(&layer.optimistic_data_json).map_err(|_| invariant())?;
        if cache_core::schema_change::is_retired(&source) || fits(&row.mutation.request, &source) {
            continue;
        }
        retire_overlay(&mut source);
        require_changed(
            driver::execute(
                connection,
                LAYER_UPDATE,
                vec![
                    Value::from_i64(mutation_id_to_sql(row.id)?),
                    text(&encode_optimistic_source(&source)),
                    Value::from_blob(encode_record_updates(&RecordUpdates::new())),
                ],
            )?,
            1,
        )?;
        retired += 1;
    }
    Ok(retired)
}

/// Composes the index shadow of every record a queued write projects again,
/// over the stored projections left.
fn recompose_queued_shadows(connection: &Db) -> Result<(), TursoStorageError> {
    let mut keys = BTreeSet::new();
    for row in driver::query(connection, QUEUE_SELECT, Vec::new())? {
        let row = parse_queue_row(&row)?;
        let source =
            decode_optimistic_source(&row.optimistic.ok_or_else(invariant)?.optimistic_data_json)
                .map_err(|_| invariant())?;
        keys.extend(
            source
                .projection_mutations
                .iter()
                .map(|mutation| mutation.record_key().clone()),
        );
    }
    let keys = keys.into_iter().collect::<Vec<_>>();
    let states = keys
        .iter()
        .cloned()
        .zip(load_projection_states(connection, &keys)?)
        .filter_map(|(key, state)| state.map(|state| (key, state)))
        .collect::<HashMap<_, _>>();
    recompose_shadows(connection, &keys, &states)
}

/// Empties the records, but for [`KEPT_RECORDS`], and every table derived
/// from them, by dropping each table and creating it again from the SQL the
/// file stores for it and its indexes. Returns how many records it dropped.
fn clear_records(connection: &Db) -> Result<u64, TursoStorageError> {
    let count = driver::query(connection, RECORD_COUNT, Vec::new())?;
    let [row] = count.as_slice() else {
        return Err(invariant());
    };
    let count = u64::try_from(required_i64(row, 0)?).map_err(|_| invariant())?;
    let kept = driver::query(connection, KEPT_RECORDS, Vec::new())?;
    let tables = DERIVED_TABLES
        .into_iter()
        .chain(
            DERIVED_STORES
                .iter()
                .flat_map(|store| store.tables.iter().copied()),
        )
        .chain(["records"])
        .collect::<Vec<_>>();
    recreate_tables(connection, &tables)?;
    for row in &kept {
        driver::execute(connection, RECORD_UPSERT, row.clone())?;
    }
    for store in &DERIVED_STORES {
        (store.clear)(connection)?;
    }
    count
        .checked_sub(u64::try_from(kept.len()).map_err(|_| invariant())?)
        .ok_or_else(invariant)
}

/// Drops `tables`, which name the tables their foreign keys reference after
/// them, and creates each again from the SQL the file stores for it and its
/// indexes. Freeing a table's pages reads each once and writes only freelist
/// pages, where deleting its rows rewrites every page of it and its indexes;
/// the stored SQL, and so the schema digest, stays as it was.
fn recreate_tables(connection: &Db, tables: &[&str]) -> Result<(), TursoStorageError> {
    let mut definitions = Vec::with_capacity(tables.len());
    for table in tables {
        let rows = driver::query(connection, TABLE_SQL, vec![text(table)])?;
        let sql = rows
            .iter()
            .map(|row| required_text(row, 0))
            .collect::<Result<Vec<_>, _>>()?;
        if sql.is_empty() {
            return Err(invariant());
        }
        definitions.push(sql);
    }
    for table in tables {
        driver::execute(connection, &format!("DROP TABLE {table}"), Vec::new())?;
    }
    // Referenced tables before the tables that name them.
    for sql in definitions.iter().rev().flatten() {
        driver::execute(connection, sql, Vec::new())?;
    }
    Ok(())
}

struct StoredRow {
    hash: String,
    incoming_hash: String,
    artifact: Vec<u8>,
}

fn load(connection: &Db) -> Result<Option<StoredRow>, TursoStorageError> {
    let rows =
        driver::query(connection, SELECT, Vec::new()).map_err(TursoStorageError::initialization)?;
    match rows.as_slice() {
        [] => Ok(None),
        [row] => Ok(Some(StoredRow {
            hash: required_text(row, 0).map_err(|_| compatibility())?,
            incoming_hash: required_text(row, 1).map_err(|_| compatibility())?,
            artifact: required_blob(row, 2).map_err(|_| compatibility())?,
        })),
        _ => Err(compatibility()),
    }
}

fn store(connection: &Db, schema: &Schema, incoming_hash: &str) -> Result<(), TursoStorageError> {
    if let Some(row) = load(connection)?
        && row.hash == schema.hash()
    {
        if row.incoming_hash != incoming_hash {
            driver::execute(connection, SET_INCOMING, vec![text(incoming_hash)])?;
        }
        return Ok(());
    }
    require_changed(
        driver::execute(
            connection,
            UPSERT,
            vec![
                text(schema.hash()),
                text(incoming_hash),
                Value::from_blob(encode_stored_schema(schema)),
            ],
        )?,
        1,
    )
}
