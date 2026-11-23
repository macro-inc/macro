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
//!   derived from them and every queued projection of them (every queued
//!   projection, when other documents read them), takes the overlay off each
//!   queued write that wrote one, and starts the backfill over (it drops the
//!   storage generation).
//! - [`Tier::Reset`] drops every record but the identity and authority, by
//!   dropping and creating each table again, with every queued projection
//!   and overlay. A tier whose statement fails, or that runs out of space,
//!   rolls back and resets instead ([`ResetReason::Failed`]); so does a
//!   native file of another schema compatibility epoch ([`leave_epoch`]).
//!
//! Queued writes are always kept: their mutations are still sent. Their
//! index shadows are composed again over what is left, under the keys
//! settled creates gave the records they name, and the identity metadata of
//! those records stays ([`QueueIdentity`]).

use super::*;
use cache_core::calendar::{CALENDAR_TYPENAME, EVENT_TYPENAME, OCCURRENCE_TYPENAME};
use cache_core::identity::{self, IdentityMap};
use cache_core::meta::Schema;
use cache_core::normalize::RecordUpdates;
use cache_core::queue::{decode_optimistic_source, encode_optimistic_source};
use cache_core::schema_change::{
    ProjectionInputs, ResetReason, SchemaChange, Tier, decode_stored_schema, encode_stored_schema,
    is_retired, overlay_fits, retire_overlay, unrecorded_schema,
};

pub(super) const CREATE_TABLE: &str = "CREATE TABLE cache_schema (slot INTEGER PRIMARY KEY, hash TEXT NOT NULL, incoming_hash TEXT NOT NULL, artifact BLOB NOT NULL)";
pub(super) const TABLE: &str = "cache_schema";

const SELECT: &str = "SELECT hash, incoming_hash, artifact FROM cache_schema WHERE slot = 0";
const UPSERT: &str = "INSERT INTO cache_schema (slot, hash, incoming_hash, artifact) VALUES (0, ?1, ?2, ?3) ON CONFLICT (slot) DO UPDATE SET hash = excluded.hash, incoming_hash = excluded.incoming_hash, artifact = excluded.artifact";
const SET_INCOMING: &str = "UPDATE cache_schema SET incoming_hash = ?1 WHERE slot = 0";
/// The hashes of a stored schema [`leave_epoch`] made unreadable, which no
/// build's schema has.
const UNREADABLE: &str = "unreadable";
const NAMESPACE_UPDATE: &str = "UPDATE meta SET value = ?1 WHERE key = 'namespace'";

/// The incoming hash of a cache that builds with different schemas wrote
/// under one engine. It names no build, so the next open of any build sorts
/// the stored schema against its own, and drops what another build wrote that
/// this one's projections read but it never refreshes.
const SEVERAL_BUILDS: &str = "several-builds";

/// Whether the cache holds a record besides storage's own metadata.
const ANY_RECORD: &str = "SELECT 1 FROM records WHERE __typename <> '__meta' LIMIT 1";
const ANY_QUEUED: &str = "SELECT 1 FROM mutation_queue LIMIT 1";
const TYPE_RECORDS_DELETE: &str = "DELETE FROM records WHERE __typename = ?1";
/// A type's index documents, by the `Typename:` prefix of their record keys
/// ([`key_range`]). Their facts go first: a cascade deletes them one document
/// at a time.
const TYPE_DOCUMENTS_DELETE: &str =
    "DELETE FROM index_documents WHERE record_key >= ?1 AND record_key < ?2";
const TYPE_DOCUMENT_COUNT: &str =
    "SELECT COUNT(*) FROM index_documents WHERE record_key >= ?1 AND record_key < ?2";
const DOCUMENT_COUNT: &str = "SELECT COUNT(*) FROM index_documents";
/// The facts of a type's documents, by [`key_range`], one per fact table.
const TYPE_FACTS_DELETE: [&str; 3] = [
    "DELETE FROM exact_facts WHERE document_id IN (SELECT id FROM index_documents WHERE record_key >= ?1 AND record_key < ?2)",
    "DELETE FROM integer_facts WHERE document_id IN (SELECT id FROM index_documents WHERE record_key >= ?1 AND record_key < ?2)",
    "DELETE FROM sort_facts WHERE document_id IN (SELECT id FROM index_documents WHERE record_key >= ?1 AND record_key < ?2)",
];
/// The record whose loss starts the backfill over (`cache_core::engine`).
const STORAGE_GENERATION_DELETE: &str =
    "DELETE FROM records WHERE __typename = '__meta' AND id = 'storage-generation'";
const LAYER_UPDATE: &str = "UPDATE optimistic_layers SET optimistic_data_json = ?2, normalized_updates = ?3 WHERE mutation_id = ?1";

// Making every document dirty drops their facts, then marks them with the one
// incomplete state, in the same transaction. Contact documents are storage's
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
/// A fact table's own indexes, which are built again after it is refilled;
/// its primary key's index has no SQL and comes back with the table.
const FACT_INDEXES: &str = "SELECT name, sql FROM sqlite_schema WHERE tbl_name = ?1 AND type = 'index' AND sql IS NOT NULL ORDER BY name";

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
/// Puts back a record a tier dropped, but never over one it kept.
const RECORD_RESTORE: &str =
    "INSERT INTO records (__typename, id, value) VALUES (?1, ?2, ?3) ON CONFLICT DO NOTHING";
const SHADOW_KEYS: &str = "SELECT record_key FROM optimistic_index_documents";
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

/// What wrote a cache that stores no schema yet, an older build's, as the
/// host knows it.
#[derive(Clone, Debug, Default)]
pub enum Unrecorded {
    /// The host kept nothing; the schema bundled with this build's sources
    /// is the guess ([`unrecorded_schema`]).
    #[default]
    Guess,
    /// The host kept it.
    Known(Arc<Schema>),
    /// The host kept it and cannot read it, so every record goes.
    Unreadable,
}

impl Unrecorded {
    fn schema(&self) -> Option<Arc<Schema>> {
        match self {
            Self::Guess => unrecorded_schema(),
            Self::Known(schema) => Some(Arc::clone(schema)),
            Self::Unreadable => None,
        }
    }
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
/// projections read `inputs`. `unrecorded` says what wrote a cache that
/// stores no schema.
pub(super) fn adopt(
    connection: &Db,
    incoming: &Arc<Schema>,
    inputs: &ProjectionInputs,
    unrecorded: &Unrecorded,
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
    let sorted = driver::write_transaction(connection, || {
        let stored = match load(connection)? {
            Some(row) => decode_stored_schema(&row.artifact).ok(),
            None if is_empty(connection)? => {
                store(connection, incoming, incoming.hash())?;
                return Ok(SchemaAdoption::unchanged(Arc::clone(incoming)));
            }
            None => unrecorded.schema(),
        };
        apply(
            connection,
            SchemaChange::classify(stored.as_deref(), incoming, inputs),
            incoming,
        )
    });
    match sorted {
        // The tier rolled back. Dropping every record reads none of them,
        // and frees the pages they held for what the cache writes next.
        Err(error) if resets_after(error) => driver::write_transaction(connection, || {
            let reset = SchemaChange {
                tier: Tier::Reset(ResetReason::Failed),
                stored: Arc::clone(incoming),
            };
            apply(connection, reset, incoming)
        }),
        sorted => sorted,
    }
    .map_err(TursoStorageError::initialization)
}

/// Whether a tier that failed with `error` resets the cache in place: a
/// statement failed, or storage filled up, and the transaction rolled back
/// (a rollback that fails leaves the outcome uncertain instead). A file that
/// is corrupt, or whose last write is in doubt, is replaced.
fn resets_after(error: TursoStorageError) -> bool {
    match error.physical_reset_reason() {
        None | Some(PhysicalResetReason::StorageFull) => true,
        Some(_) => false,
    }
}

/// Whether the cache holds no record and no queued write: nothing a schema
/// shaped.
fn is_empty(connection: &Db) -> Result<bool, TursoStorageError> {
    Ok(
        driver::query(connection, ANY_RECORD, Vec::new())?.is_empty()
            && driver::query(connection, ANY_QUEUED, Vec::new())?.is_empty(),
    )
}

/// Applies `change`'s tier and stores its schema, inside the caller's
/// transaction.
fn apply(
    connection: &Db,
    change: SchemaChange,
    incoming: &Schema,
) -> Result<SchemaAdoption, TursoStorageError> {
    let mut adoption = SchemaAdoption::unchanged(Arc::clone(&change.stored));
    match &change.tier {
        Tier::Compatible => {}
        Tier::Types {
            changed,
            every_document,
        } => {
            let identity = queue_identity(connection)?;
            // Facts go before the documents, which would otherwise cascade
            // to them one document at a time.
            if *every_document {
                keep_only_facts(connection, DOCUMENTS_KEEPING_FACTS, Vec::new())?;
            } else {
                drop_facts(connection, changed)?;
            }
            adoption.dropped_records = drop_types(connection, changed)?;
            restore_identity(connection, &identity)?;
            if *every_document {
                let marked = driver::execute(connection, EVERY_DOCUMENT_DIRTY, Vec::new())?;
                adoption.incomplete_documents = u64::try_from(marked).map_err(|_| invariant())?;
            }
            // When other documents read a changed type, any queued
            // projection may hold facts it fed, as the build before derived
            // them.
            let dropped = |key: &PredicateRecordKey| {
                *every_document
                    || key
                        .as_str()
                        .split_once(':')
                        .is_some_and(|(typename, _)| changed.contains(typename))
            };
            let mut queue = conform_queue(
                connection,
                |request, source| overlay_fits(&change.stored, changed, request, source),
                dropped,
                &identity.aliases,
            )?;
            // A shadow of a dropped record goes even when no queued write
            // names its key, as one an older build left may.
            for row in driver::query(connection, SHADOW_KEYS, Vec::new())? {
                let key =
                    PredicateRecordKey::new(required_text(&row, 0)?).map_err(|_| invariant())?;
                if dropped(&key) {
                    queue.projected.insert(key);
                }
            }
            adoption.retired_overlays = queue.retired;
            recompose_queued_shadows(connection, queue.projected, &identity.aliases)?;
            driver::execute(connection, STORAGE_GENERATION_DELETE, Vec::new())?;
        }
        Tier::Reset(_) => {
            let identity = queue_identity(connection)?;
            adoption.dropped_records = clear_records(connection)?;
            restore_identity(connection, &identity)?;
            // No queued projection is left to compose a shadow from.
            recreate_tables(connection, &SHADOW_TABLES)?;
            adoption.retired_overlays =
                conform_queue(connection, |_, _| false, |_| true, &identity.aliases)?.retired;
        }
    }
    store(connection, &change.stored, incoming.hash())?;
    adoption.change = Some(change.tier);
    Ok(adoption)
}

/// Moves a native file written under another schema compatibility epoch to
/// this build's `namespace`, with its stored schema made unreadable, so the
/// adoption after the open resets it and keeps its queued writes
/// ([`ResetReason::Unreadable`]). A file from before storage 13 stores no
/// schema, and the bundled guess would keep its records. One transaction, so
/// an interrupted open leaves the old namespace.
pub(super) fn leave_epoch(connection: &Db, namespace: &str) -> Result<(), TursoStorageError> {
    driver::write_transaction(connection, || {
        mark_unreadable(connection)?;
        driver::execute(connection, NAMESPACE_UPDATE, vec![text(namespace)])?;
        Ok(())
    })
    .map_err(TursoStorageError::initialization)
}

/// Overwrites the stored schema with one no build can read, inside the
/// caller's transaction, so the next adoption resets the cache.
pub(super) fn mark_unreadable(connection: &Db) -> Result<(), TursoStorageError> {
    driver::execute(
        connection,
        UPSERT,
        vec![
            text(UNREADABLE),
            text(UNREADABLE),
            Value::from_blob(vec![0]),
        ],
    )?;
    Ok(())
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

/// The bounds of the record keys of a type's records, `Typename:` to
/// `Typename;`: `;` follows `:`, which no type name holds.
fn key_range(typename: &str) -> Vec<Value> {
    vec![text(&format!("{typename}:")), text(&format!("{typename};"))]
}

/// Drops the facts of the documents of `changed` record types. When those
/// are most of the documents, the facts of the others are kept and every fact
/// table created again around them ([`keep_only_facts`]), which costs what
/// the kept facts do instead of what the dropped ones do.
fn drop_facts(connection: &Db, changed: &BTreeSet<String>) -> Result<(), TursoStorageError> {
    let ranges = changed
        .iter()
        .map(|typename| key_range(typename))
        .collect::<Vec<_>>();
    let mut dropping = 0_u64;
    for range in &ranges {
        dropping += count(connection, TYPE_DOCUMENT_COUNT, range.clone())?;
    }
    if dropping == 0 {
        return Ok(());
    }
    if dropping.saturating_mul(2) <= count(connection, DOCUMENT_COUNT, Vec::new())? {
        for range in &ranges {
            for statement in TYPE_FACTS_DELETE {
                driver::execute(connection, statement, range.clone())?;
            }
        }
        return Ok(());
    }
    let dropped = (0..ranges.len())
        .map(|index| {
            format!(
                "(d.record_key >= ?{} AND d.record_key < ?{})",
                2 * index + 1,
                2 * index + 2
            )
        })
        .collect::<Vec<_>>()
        .join(" OR ");
    keep_only_facts(
        connection,
        &format!("NOT ({dropped})"),
        ranges.into_iter().flatten().collect(),
    )
}

/// Drops the records of `changed` record types with every row derived from
/// them; their documents' facts are gone already. Returns how many records
/// it dropped.
fn drop_types(connection: &Db, changed: &BTreeSet<String>) -> Result<u64, TursoStorageError> {
    let mut dropped = 0_u64;
    for typename in changed {
        let records = driver::execute(connection, TYPE_RECORDS_DELETE, vec![text(typename)])?;
        dropped += u64::try_from(records).map_err(|_| invariant())?;
        driver::execute(connection, TYPE_DOCUMENTS_DELETE, key_range(typename))?;
    }
    // The Quick Access rows' key leads with their profile, so one statement
    // reads the table once for every changed type.
    if !changed.is_empty() {
        let names = (1..=changed.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        driver::execute(
            connection,
            &format!("DELETE FROM search_documents WHERE __typename IN ({names})"),
            changed.iter().map(|typename| text(typename)).collect(),
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

/// Keeps only the facts of the documents `d` that `kept` holds for, with its
/// `parameters`. They wait in a table of their own while each fact table is
/// created again: deleting most of a table's rows rewrites every page of it
/// and its indexes, where refilling a new table in key order and then
/// building its indexes writes each page once.
fn keep_only_facts(
    connection: &Db,
    kept: &str,
    parameters: Vec<Value>,
) -> Result<(), TursoStorageError> {
    let mut indexes = Vec::new();
    for table in FACT_TABLES {
        let waiting = format!("{KEPT_FACTS_PREFIX}{table}");
        driver::execute(
            connection,
            &format!("CREATE TABLE {waiting} (document_id, attribute, value)"),
            Vec::new(),
        )?;
        driver::execute(
            connection,
            &format!(
                "INSERT INTO {waiting} (document_id, attribute, value) SELECT f.document_id, f.attribute, f.value FROM index_documents d JOIN {table} f ON f.document_id = d.id WHERE {kept}"
            ),
            parameters.clone(),
        )?;
        for row in driver::query(connection, FACT_INDEXES, vec![text(table)])? {
            indexes.push((required_text(&row, 0)?, required_text(&row, 1)?));
        }
    }
    // Without their indexes, the tables are created again bare.
    for (name, _) in &indexes {
        driver::execute(connection, &format!("DROP INDEX {name}"), Vec::new())?;
    }
    recreate_tables(connection, &FACT_TABLES)?;
    for table in FACT_TABLES {
        let waiting = format!("{KEPT_FACTS_PREFIX}{table}");
        driver::execute(
            connection,
            &format!(
                "INSERT INTO {table} (document_id, attribute, value) SELECT document_id, attribute, value FROM {waiting} ORDER BY document_id, attribute, value"
            ),
            Vec::new(),
        )?;
        driver::execute(connection, &format!("DROP TABLE {waiting}"), Vec::new())?;
    }
    for (_, sql) in &indexes {
        driver::execute(connection, sql, Vec::new())?;
    }
    Ok(())
}

/// The one count `sql` selects.
fn count(connection: &Db, sql: &str, parameters: Vec<Value>) -> Result<u64, TursoStorageError> {
    let rows = driver::query(connection, sql, parameters)?;
    let [row] = rows.as_slice() else {
        return Err(invariant());
    };
    u64::try_from(required_i64(row, 0)?).map_err(|_| invariant())
}

/// What the queued writes read of the records a tier drops, read before it
/// drops them. Settling a write that created a record stores an alias from
/// the local key later queued writes name to the key the server gave it, and
/// moves their shadows to that key. The records they name hold the identity
/// metadata later settlements and replays read, which the engine's own
/// snapshot retirement keeps too.
struct QueueIdentity {
    /// Each aliased key the queue names, to the key its aliases end at.
    aliases: IdentityMap,
    /// The identity metadata of each record the queue names or an alias
    /// leads to ([`identity::identity_metadata`]).
    metadata: Vec<(RecordKey, Record)>,
}

/// Reads [`QueueIdentity`]: the keys each queued write binds, projects or
/// overlays, and the keys their aliases lead to.
fn queue_identity(connection: &Db) -> Result<QueueIdentity, TursoStorageError> {
    let mut named = BTreeSet::new();
    for row in driver::query(connection, QUEUE_SELECT, Vec::new())? {
        let layer = parse_queue_row(&row)?.optimistic.ok_or_else(invariant)?;
        let source =
            decode_optimistic_source(&layer.optimistic_data_json).map_err(|_| invariant())?;
        named.extend(
            source
                .identity_bindings
                .into_iter()
                .map(|binding| binding.local_key),
        );
        named.extend(
            source
                .projection_mutations
                .iter()
                .map(|mutation| EntityKey(mutation.record_key().as_str().to_owned().into())),
        );
        named.extend(layer.normalized_updates.into_keys());
    }
    let mut targets = IdentityMap::new();
    let mut metadata = Vec::new();
    let mut seen = named.clone();
    let mut next = named.into_iter().collect::<Vec<_>>();
    for _ in 0..=identity::MAX_ALIAS_CHAIN_DEPTH {
        // A key no record can have holds nothing to keep.
        let (entities, keys): (Vec<_>, Vec<_>) = std::mem::take(&mut next)
            .into_iter()
            .filter_map(|entity| {
                RecordKey::from_entity(&entity)
                    .ok()
                    .map(|key| (entity, key))
            })
            .unzip();
        if keys.is_empty() {
            break;
        }
        let records = record_batch::read(connection, &keys)?;
        for ((entity, key), record) in entities.into_iter().zip(keys).zip(records) {
            let Some(record) = record else {
                continue;
            };
            if let Some(target) = identity::alias_target(&record) {
                if seen.insert(target.clone()) {
                    next.push(target.clone());
                }
                targets.insert(entity, target.clone());
            }
            if let Some(kept) = identity::identity_metadata(record) {
                metadata.push((key, kept));
            }
        }
    }
    // Each alias leads to the end of its chain, as the engine reads it; a
    // cycle stops where it would repeat.
    let aliases = targets
        .keys()
        .map(|local| {
            let mut target = &targets[local];
            for _ in 0..identity::MAX_ALIAS_CHAIN_DEPTH {
                match targets.get(target) {
                    Some(further) if further != local => target = further,
                    _ => break,
                }
            }
            (local.clone(), target.clone())
        })
        .collect();
    Ok(QueueIdentity { aliases, metadata })
}

/// Puts back the identity metadata of each record the queue named that the
/// tier dropped.
fn restore_identity(connection: &Db, identity: &QueueIdentity) -> Result<(), TursoStorageError> {
    for (key, record) in &identity.metadata {
        driver::execute(
            connection,
            RECORD_RESTORE,
            vec![
                text(&key.typename),
                text(&key.id),
                Value::from_blob(encode_record(record)),
            ],
        )?;
    }
    Ok(())
}

/// What [`conform_queue`] did to the queued writes.
struct ConformedQueue {
    /// Overlays taken off.
    retired: u64,
    /// Every record a queued write projected before any projection went,
    /// under the key it names and the key its alias leads to.
    projected: BTreeSet<PredicateRecordKey>,
}

/// Takes the optimistic overlay off each queued write that does not `fit`,
/// keeping its mutation, and drops its projections of the records `dropped`
/// holds for, under the key they name or the key its alias in `aliases`
/// leads to: their documents went with them, and a shadow composed from one
/// would show a record the cache no longer holds, as the build before shaped
/// it.
fn conform_queue(
    connection: &Db,
    fits: impl Fn(&MutationRequest, &cache_core::queue::OptimisticSource) -> bool,
    dropped: impl Fn(&PredicateRecordKey) -> bool,
    aliases: &IdentityMap,
) -> Result<ConformedQueue, TursoStorageError> {
    let aliased = |key: &PredicateRecordKey| {
        aliases
            .get(&EntityKey(key.as_str().to_owned().into()))
            .and_then(|target| PredicateRecordKey::new(target.to_string()).ok())
    };
    let mut queue = ConformedQueue {
        retired: 0,
        projected: BTreeSet::new(),
    };
    for row in driver::query(connection, QUEUE_SELECT, Vec::new())? {
        let row = parse_queue_row(&row)?;
        let layer = row.optimistic.ok_or_else(invariant)?;
        let mut source =
            decode_optimistic_source(&layer.optimistic_data_json).map_err(|_| invariant())?;
        let projections = source.projection_mutations.len();
        for mutation in &source.projection_mutations {
            queue.projected.insert(mutation.record_key().clone());
            queue.projected.extend(aliased(mutation.record_key()));
        }
        source.projection_mutations.retain(|mutation| {
            let key = mutation.record_key();
            !dropped(key) && !aliased(key).is_some_and(|target| dropped(&target))
        });
        let updates = if !is_retired(&source) && !fits(&row.mutation.request, &source) {
            retire_overlay(&mut source);
            queue.retired += 1;
            RecordUpdates::new()
        } else if source.projection_mutations.len() == projections {
            continue;
        } else {
            layer.normalized_updates
        };
        require_changed(
            driver::execute(
                connection,
                LAYER_UPDATE,
                vec![
                    Value::from_i64(mutation_id_to_sql(row.id)?),
                    text(&encode_optimistic_source(&source)),
                    Value::from_blob(encode_record_updates(&updates)),
                ],
            )?,
            1,
        )?;
    }
    Ok(queue)
}

/// Composes the index shadow of each of `keys` again, from the queued
/// projections left, moved through `aliases`, over the stored projections
/// left.
fn recompose_queued_shadows(
    connection: &Db,
    keys: BTreeSet<PredicateRecordKey>,
    aliases: &IdentityMap,
) -> Result<(), TursoStorageError> {
    let keys = keys.into_iter().collect::<Vec<_>>();
    let states = keys
        .iter()
        .cloned()
        .zip(load_projection_states(connection, &keys)?)
        .filter_map(|(key, state)| state.map(|state| (key, state)))
        .collect::<HashMap<_, _>>();
    recompose_shadows(connection, &keys, &states, aliases)
}

/// Empties the records, but for [`KEPT_RECORDS`], and every table derived
/// from them, by dropping each table and creating it again from the SQL the
/// file stores for it and its indexes. Returns how many records it dropped.
fn clear_records(connection: &Db) -> Result<u64, TursoStorageError> {
    let count = count(connection, RECORD_COUNT, Vec::new())?;
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
        [row] => Ok(Some(
            match (
                required_text(row, 0),
                required_text(row, 1),
                required_blob(row, 2),
            ) {
                (Ok(hash), Ok(incoming_hash), Ok(artifact)) => StoredRow {
                    hash,
                    incoming_hash,
                    artifact,
                },
                // Values of a type no build writes read as a schema no build
                // can, which resets the cache and keeps its queue.
                _ => StoredRow {
                    hash: UNREADABLE.to_owned(),
                    incoming_hash: UNREADABLE.to_owned(),
                    artifact: Vec::new(),
                },
            },
        )),
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
