//! Opening a cache with another build's GraphQL schema: each tier's effect
//! on records, derived rows, queued writes and the storage generation.
use super::*;
use crate::storage::migration::test_hooks;
use cache_core::engine::{IDENTITY_META_KEY, IDENTITY_VALUE_FIELD};
use cache_core::meta::Schema;
use cache_core::queue::{OptimisticSource, decode_optimistic_source, encode_optimistic_source};
use cache_core::schema_change::{ProjectionInputs, ResetReason, Tier, is_retired};
use predicate_index::OptimisticProjectionMutation;

const OLD: &str = "type Query { thing: Thing note: Note } type Mutation { rename(id: ID!): Thing edit(id: ID!): Note } type Thing { id: ID! value: String } type Note { id: ID! value: String }";
/// [`OLD`] with a field added to `Thing`.
const ADDED: &str = "type Query { thing: Thing note: Note } type Mutation { rename(id: ID!): Thing edit(id: ID!): Note } type Thing { id: ID! value: String extra: Int } type Note { id: ID! value: String }";
/// [`OLD`] with `Thing.value` retyped.
const RETYPED: &str = "type Query { thing: Thing note: Note } type Mutation { rename(id: ID!): Thing edit(id: ID!): Note } type Thing { id: ID! value: Int } type Note { id: ID! value: String }";
/// [`OLD`] under another query root.
const ROOTS: &str = "schema { query: Root mutation: Mutation } type Root { thing: Thing note: Note } type Mutation { rename(id: ID!): Thing edit(id: ID!): Note } type Thing { id: ID! value: String } type Note { id: ID! value: String }";

fn schema(sdl: &str) -> Arc<Schema> {
    Schema::from_sdl(sdl).unwrap()
}

fn adopt(storage: &TursoStorage, sdl: &str, inputs: &ProjectionInputs) -> SchemaAdoption {
    storage
        .adopt_schema(&schema(sdl), inputs, Unrecorded::Guess)
        .unwrap()
}

fn types(names: &[&str], every_document: bool) -> Option<Tier> {
    Some(Tier::Types {
        changed: names.iter().map(|name| (*name).to_owned()).collect(),
        every_document,
    })
}

fn pending(
    label: &str,
    query: &str,
    data: serde_json::Value,
    projected: &[&str],
) -> NewQueuedMutation {
    let mut mutation = queued(label);
    mutation.mutation.request.query = query.to_owned();
    mutation.optimistic.optimistic_data_json = encode_optimistic_source(&OptimisticSource {
        client_metadata: None,
        identity_bindings: Vec::new(),
        mutation_data: data,
        link_patches: Vec::new(),
        revalidations: Vec::new(),
        projection_mutations: projected
            .iter()
            .map(|key| {
                OptimisticProjectionMutation::Replace(authoritative_projection(key, "queued"))
            })
            .collect(),
        uncertain_calendar_event_keys: Vec::new(),
    });
    mutation
}

/// A cache written under [`OLD`]: three records of each type, a document for
/// the first of each, the identity, a storage generation, and two queued
/// writes, one returning a `Thing` and one a `Note`.
async fn populate(storage: TursoStorage) -> TursoStorage {
    assert_eq!(adopt(&storage, OLD, &ProjectionInputs::none()).change, None);
    let mut storage = storage;
    let mut identity = Record::default();
    identity.fields.insert(
        IDENTITY_VALUE_FIELD.into(),
        cache_core::value::CacheValue::String("viewer".into()),
    );
    let mut records = vec![(key(IDENTITY_META_KEY), identity)];
    for index in 0..3 {
        records.push((key(&format!("Thing:{index}")), record("thing")));
        records.push((key(&format!("Note:{index}")), record("note")));
    }
    storage
        .put_batch_with_projections(
            records,
            vec![
                ProjectionMutation::Replace(authoritative_projection("Thing:0", "owner")),
                ProjectionMutation::Replace(authoritative_projection("Note:0", "owner")),
            ],
        )
        .await
        .unwrap();
    let mut engine = cache_core::engine::Engine::new(storage);
    engine.current_storage_generation().await.unwrap();
    let mut storage = engine.into_storage();
    storage
        .enqueue_mutation(pending(
            "Rename",
            "mutation Rename { rename(id: \"1\") { id value } }",
            serde_json::json!({ "rename": { "id": "1", "value": "renamed" } }),
            &["Thing:1"],
        ))
        .await
        .unwrap();
    storage
        .enqueue_mutation(pending(
            "Edit",
            "mutation Edit { edit(id: \"1\") { id value } }",
            serde_json::json!({ "edit": { "id": "1", "value": "edited" } }),
            &["Note:1"],
        ))
        .await
        .unwrap();
    storage
}

fn count(storage: &TursoStorage, sql: &str) -> i64 {
    raw_scalar(storage, sql)
}

/// How many facts of every kind the document of `key` has.
fn facts(storage: &TursoStorage, key: &str) -> i64 {
    ["exact_facts", "integer_facts", "sort_facts"]
        .into_iter()
        .map(|table| {
            count(
                storage,
                &format!(
                    "SELECT count(*) FROM {table} f JOIN index_documents d ON d.id = f.document_id WHERE d.record_key = '{key}'"
                ),
            )
        })
        .sum()
}

fn has_generation(storage: &TursoStorage) -> bool {
    count(
        storage,
        "SELECT count(*) FROM records WHERE __typename = '__meta' AND id = 'storage-generation'",
    ) == 1
}

/// Every row of every table but the stored schema's, in a stable order.
fn rows_but_schema(storage: &TursoStorage) -> Vec<String> {
    let connection = storage.connection();
    let mut lines = Vec::new();
    for table in driver::query(
        &connection,
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'cache_schema' ORDER BY name",
        vec![],
    )
    .unwrap()
    {
        let table = required_text(&table, 0).unwrap();
        for row in driver::query(&connection, &format!("SELECT * FROM {table}"), vec![]).unwrap() {
            lines.push(format!("{table} {row:?}"));
        }
    }
    lines.sort();
    lines
}

async fn sources(storage: &mut TursoStorage) -> Vec<OptimisticSource> {
    storage
        .load_mutation_queue()
        .await
        .unwrap()
        .into_iter()
        .map(|queued| decode_optimistic_source(&queued.optimistic.optimistic_data_json).unwrap())
        .collect()
}

fn stored_incoming_hash(storage: &TursoStorage) -> String {
    let rows = driver::query(
        &storage.connection(),
        "SELECT incoming_hash FROM cache_schema",
        vec![],
    )
    .unwrap();
    required_text(&rows[0], 0).unwrap()
}

#[test]
fn an_empty_cache_takes_the_schema_and_reopens_without_sorting() {
    let storage = TursoStorage::open_in_memory("schema-empty").unwrap();
    for _ in 0..2 {
        let adoption = adopt(&storage, OLD, &ProjectionInputs::every());
        assert_eq!(adoption.outcome(), "unchanged");
        assert_eq!(adoption.schema.hash(), schema(OLD).hash());
    }
    assert_eq!(count(&storage, "SELECT count(*) FROM cache_schema"), 1);
}

#[test]
fn a_compatible_change_keeps_every_row() {
    block_on(async {
        let storage = populate(TursoStorage::open_in_memory("schema-compatible").unwrap()).await;
        let rows = rows_but_schema(&storage);
        let queue = storage.load_mutation_queue().await.unwrap();

        let adoption = adopt(&storage, ADDED, &ProjectionInputs::none());
        assert_eq!(adoption.change, Some(Tier::Compatible));
        assert_eq!(adoption.outcome(), "compatible");
        assert_eq!(rows_but_schema(&storage), rows);
        assert_eq!(storage.load_mutation_queue().await.unwrap(), queue);
        assert_eq!(
            adopt(&storage, ADDED, &ProjectionInputs::none()).change,
            None
        );

        // Rolling back removes a field nothing reads: the overlay keeps it.
        let back = adopt(&storage, OLD, &ProjectionInputs::none());
        assert_eq!(back.change, Some(Tier::Compatible));
        assert!(back.schema.field_meta("Thing", "extra").is_some());
        assert_eq!(rows_but_schema(&storage), rows);
        // The build reopens with the overlay it stored, without sorting.
        let again = adopt(&storage, OLD, &ProjectionInputs::none());
        assert_eq!(again.change, None);
        assert_eq!(again.schema.hash(), back.schema.hash());
    });
}

#[test]
fn a_changed_type_drops_its_rows_and_keeps_other_types_warm() {
    block_on(async {
        let mut storage = populate(TursoStorage::open_in_memory("schema-types").unwrap()).await;
        let notes = count(
            &storage,
            "SELECT count(*) FROM records WHERE __typename = 'Note'",
        );
        let commands = storage
            .load_mutation_queue()
            .await
            .unwrap()
            .into_iter()
            .map(|queued| (queued.id, queued.mutation.request))
            .collect::<Vec<_>>();

        let adoption = adopt(&storage, RETYPED, &ProjectionInputs::none());
        assert_eq!(adoption.change, types(&["Thing"], false));
        assert_eq!(adoption.outcome(), "types");
        assert_eq!(adoption.dropped_records, 3);
        assert_eq!(adoption.incomplete_documents, 0);
        assert_eq!(adoption.retired_overlays, 1);

        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM records WHERE __typename = 'Thing'"
            ),
            0
        );
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM records WHERE __typename = 'Note'"
            ),
            notes
        );
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM records WHERE __typename = '__meta' AND id = 'identity'"
            ),
            1
        );
        assert!(!has_generation(&storage), "the backfill starts over");
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM index_documents WHERE record_key LIKE 'Thing:%'"
            ),
            0
        );
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM index_documents WHERE record_key = 'Note:0' AND state = 0"
            ),
            1
        );
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM exact_facts f JOIN index_documents d ON d.id = f.document_id WHERE d.record_key = 'Note:0'"
            ),
            2
        );

        // Both writes stay queued; only the one returning a `Thing` loses
        // its overlay. The projection of the dropped `Thing` goes with its
        // document; the `Note`'s stays, and so does its shadow.
        let after = storage.load_mutation_queue().await.unwrap();
        assert_eq!(
            after
                .iter()
                .map(|queued| (queued.id, queued.mutation.request.clone()))
                .collect::<Vec<_>>(),
            commands
        );
        assert_eq!(after[0].optimistic.normalized_updates, RecordUpdates::new());
        let sources = sources(&mut storage).await;
        assert!(is_retired(&sources[0]));
        assert!(!is_retired(&sources[1]));
        assert!(sources[0].projection_mutations.is_empty());
        assert_eq!(sources[1].projection_mutations.len(), 1);
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM optimistic_index_documents WHERE record_key = 'Note:1'"
            ),
            1
        );
        assert_eq!(
            count(&storage, "SELECT count(*) FROM optimistic_index_documents"),
            1
        );

        assert_eq!(
            adopt(&storage, RETYPED, &ProjectionInputs::none()).change,
            None
        );
    });
}

#[test]
fn a_retired_overlay_takes_its_projections_of_kept_types_with_it() {
    block_on(async {
        let mut storage =
            populate(TursoStorage::open_in_memory("schema-retired-projections").unwrap()).await;
        // One write returns a changed `Thing` and lists a `Note` that only
        // its overlay holds.
        storage
            .enqueue_mutation(pending(
                "RenameAndNote",
                "mutation RenameAndNote { rename(id: \"2\") { id value } }",
                serde_json::json!({ "rename": { "id": "2", "value": "renamed" } }),
                &["Thing:2", "Note:new"],
            ))
            .await
            .unwrap();
        let note_shadow =
            "SELECT count(*) FROM optimistic_index_documents WHERE record_key = 'Note:new'";

        let adoption = adopt(&storage, RETYPED, &ProjectionInputs::none());
        assert_eq!(adoption.retired_overlays, 2);
        let sources = sources(&mut storage).await;
        assert!(is_retired(&sources[2]));
        assert!(sources[2].projection_mutations.is_empty());
        assert_eq!(
            count(&storage, note_shadow),
            0,
            "no list entry outlives the overlay that held its record"
        );
        assert_eq!(
            count(&storage, "SELECT count(*) FROM optimistic_index_documents"),
            1
        );
    });
}

#[test]
fn a_type_holding_most_documents_keeps_the_others_facts() {
    block_on(async {
        let database = TursoMemoryDatabase::new("schema-most-documents.db");
        let mut storage = populate(database.open("scope").unwrap()).await;
        storage
            .put_batch_with_projections(
                Vec::new(),
                ["Thing:1", "Thing:2"]
                    .into_iter()
                    .map(|key| ProjectionMutation::Replace(authoritative_projection(key, "owner")))
                    .collect(),
            )
            .await
            .unwrap();
        let note_facts = facts(&storage, "Note:0");
        assert_eq!(note_facts, 3);

        let adoption = adopt(&storage, RETYPED, &ProjectionInputs::none());
        assert_eq!(adoption.change, types(&["Thing"], false));
        assert_eq!(adoption.incomplete_documents, 0);
        for thing in ["Thing:0", "Thing:1", "Thing:2"] {
            assert_eq!(facts(&storage, thing), 0, "{thing}");
        }
        for table in ["exact_facts", "integer_facts", "sort_facts"] {
            assert_eq!(
                count(
                    &storage,
                    &format!(
                        "SELECT count(*) FROM {table} WHERE document_id NOT IN (SELECT id FROM index_documents)"
                    )
                ),
                0,
                "{table}"
            );
        }
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM index_documents WHERE record_key LIKE 'Thing:%'"
            ),
            0
        );
        assert_eq!(facts(&storage, "Note:0"), note_facts);
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM sqlite_schema WHERE name LIKE 'schema_change_kept_%'"
            ),
            0
        );
        storage.try_close().unwrap();

        // The fact tables and their indexes are the fresh schema's.
        let storage = database.open("scope").unwrap();
        assert!(has_fresh_schema(&storage.connection()).unwrap());
        assert_eq!(
            adopt(&storage, RETYPED, &ProjectionInputs::none()).change,
            None
        );
        storage.try_close().unwrap();
    });
}

#[test]
fn a_type_other_documents_read_makes_them_incomplete() {
    block_on(async {
        let database = TursoMemoryDatabase::new("schema-every-document.db");
        let mut storage = populate(database.open("scope").unwrap()).await;
        let mut contact = Record::default();
        // A contact of the viewer: keyed by the viewer and the person.
        let user = "macro|person@example.com";
        let viewer = uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_OID, b"viewer");
        let contact_key = format!(
            "GraphqlContact:{}",
            uuid::Uuid::new_v5(&viewer, user.as_bytes())
        );
        for (field, value) in [
            ("__typename", "GraphqlContact"),
            ("userId", user),
            ("email", "person@example.com"),
            ("name", "Person"),
        ] {
            contact.fields.insert(
                field.into(),
                cache_core::value::CacheValue::String(value.into()),
            );
        }
        storage
            .put_batch(vec![(key(&contact_key), contact)])
            .await
            .unwrap();
        let kept_facts = facts(&storage, &contact_key);
        assert!(kept_facts > 0);
        let inputs = ProjectionInputs::none().nested("Thing", &["value"]);

        let adoption = adopt(&storage, RETYPED, &inputs);
        assert_eq!(adoption.change, types(&["Thing"], true));
        assert_eq!(adoption.incomplete_documents, 1);
        assert_eq!(
            count(
                &storage,
                "SELECT state FROM index_documents WHERE record_key = 'Note:0'"
            ),
            1
        );
        assert_eq!(facts(&storage, "Note:0"), 0);
        assert_eq!(facts(&storage, &contact_key), kept_facts);
        assert_eq!(
            count(
                &storage,
                &format!("SELECT state FROM index_documents WHERE record_key = '{contact_key}'")
            ),
            0
        );
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM sqlite_schema WHERE name LIKE 'schema_change_kept_%'"
            ),
            0
        );
        storage.try_close().unwrap();

        // The recreated tables are the fresh schema's, byte for byte.
        let storage = database.open("scope").unwrap();
        assert!(has_fresh_schema(&storage.connection()).unwrap());
        assert_eq!(adopt(&storage, RETYPED, &inputs).change, None);
        storage.try_close().unwrap();
    });
}

#[test]
fn a_reset_keeps_the_identity_and_the_queue() {
    block_on(async {
        let database = TursoMemoryDatabase::new("schema-reset.db");
        let mut storage = populate(database.open("scope").unwrap()).await;
        let records = count(&storage, "SELECT count(*) FROM records");
        let commands = storage
            .load_mutation_queue()
            .await
            .unwrap()
            .into_iter()
            .map(|queued| (queued.id, queued.mutation.request))
            .collect::<Vec<_>>();

        let adoption = adopt(&storage, ROOTS, &ProjectionInputs::none());
        assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Roots)));
        assert_eq!(adoption.reset_reason(), Some(ResetReason::Roots));
        assert_eq!(adoption.outcome(), "reset");
        assert_eq!(adoption.schema.hash(), schema(ROOTS).hash());
        assert_eq!(
            adoption.dropped_records,
            u64::try_from(records - 1).unwrap()
        );
        assert_eq!(adoption.retired_overlays, 2);
        assert_eq!(count(&storage, "SELECT count(*) FROM records"), 1);
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM records WHERE __typename = '__meta' AND id = 'identity'"
            ),
            1
        );
        for table in ["index_documents", "exact_facts", "search_documents"] {
            assert_eq!(
                count(&storage, &format!("SELECT count(*) FROM {table}")),
                0,
                "{table}"
            );
        }
        assert_eq!(
            storage
                .load_mutation_queue()
                .await
                .unwrap()
                .into_iter()
                .map(|queued| (queued.id, queued.mutation.request))
                .collect::<Vec<_>>(),
            commands
        );
        let sources = sources(&mut storage).await;
        assert!(sources.iter().all(is_retired));
        assert!(
            sources
                .iter()
                .all(|source| source.projection_mutations.is_empty()),
            "every projected record went"
        );
        assert_eq!(
            count(&storage, "SELECT count(*) FROM optimistic_index_documents"),
            0
        );
        storage.try_close().unwrap();

        let storage = database.open("scope").unwrap();
        assert!(has_fresh_schema(&storage.connection()).unwrap());
        assert_eq!(
            adopt(&storage, ROOTS, &ProjectionInputs::none()).change,
            None
        );
        storage.try_close().unwrap();
    });
}

#[test]
fn queued_writes_without_records_are_still_sorted() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("schema-queue-only").unwrap();
        storage
            .enqueue_mutation(pending(
                "Rename",
                "mutation Rename { rename(id: \"1\") { id value } }",
                serde_json::json!({ "rename": { "id": "1", "value": "renamed" } }),
                &["Thing:1"],
            ))
            .await
            .unwrap();
        let adoption = storage
            .adopt_schema(
                &schema(RETYPED),
                &ProjectionInputs::none(),
                Unrecorded::Known(schema(OLD)),
            )
            .unwrap();
        assert_eq!(adoption.change, types(&["Thing"], false));
        assert_eq!(adoption.retired_overlays, 1);
        let sources = sources(&mut storage).await;
        assert!(is_retired(&sources[0]));
        assert!(sources[0].projection_mutations.is_empty());
    });
}

#[test]
fn a_change_that_fails_drops_every_record_and_keeps_the_queue() {
    block_on(async {
        let mut storage = populate(TursoStorage::open_in_memory("schema-failed").unwrap()).await;
        // Dropping every document's facts keeps the others in a table of
        // this name, so the change's own tier fails.
        raw_execute(
            &storage,
            "CREATE TABLE schema_change_kept_exact_facts (planted)",
            vec![],
        );
        let adoption = adopt(&storage, RETYPED, &ProjectionInputs::every());
        assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Failed)));
        assert_eq!(adoption.outcome(), "reset");
        assert_eq!(
            adoption.reset_reason().map(<&'static str>::from),
            Some("failed")
        );
        assert_eq!(adoption.schema.hash(), schema(RETYPED).hash());
        assert_eq!(adoption.retired_overlays, 2);
        assert_eq!(count(&storage, "SELECT count(*) FROM records"), 1);
        assert_eq!(storage.load_mutation_queue().await.unwrap().len(), 2);
        assert!(sources(&mut storage).await.iter().all(is_retired));
    });
}

/// `scope`'s namespace under the compatibility epoch before this build's.
fn previous_epoch_namespace(scope: &str) -> String {
    format!(
        "graphql-cache:{scope}:s{}:v{}",
        cache_core::codec::CACHE_SCHEMA_COMPATIBILITY_EPOCH - 1,
        cache_core::codec::CACHE_FORMAT_VERSION
    )
}

#[test]
fn another_epochs_cache_keeps_its_queue_and_drops_its_records() {
    block_on(async {
        let database = TursoMemoryDatabase::new("schema-epoch.db");
        let storage = populate(database.open("scope").unwrap()).await;
        let commands = storage
            .load_mutation_queue()
            .await
            .unwrap()
            .into_iter()
            .map(|queued| (queued.id, queued.mutation.request))
            .collect::<Vec<_>>();
        raw_execute(
            &storage,
            "UPDATE meta SET value = ?1 WHERE key = 'namespace'",
            vec![text(&previous_epoch_namespace("scope"))],
        );
        storage.try_close().unwrap();

        let mut storage = database.open("scope").unwrap();
        let namespace = driver::query(
            &storage.connection(),
            "SELECT value FROM meta WHERE key = 'namespace'",
            vec![],
        )
        .unwrap();
        assert_eq!(
            required_text(&namespace[0], 0).unwrap(),
            cache_namespace("scope")
        );
        let adoption = adopt(&storage, OLD, &ProjectionInputs::none());
        assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Unreadable)));
        assert_eq!(count(&storage, "SELECT count(*) FROM records"), 1);
        assert_eq!(
            storage
                .load_mutation_queue()
                .await
                .unwrap()
                .into_iter()
                .map(|queued| (queued.id, queued.mutation.request))
                .collect::<Vec<_>>(),
            commands
        );
        assert!(sources(&mut storage).await.iter().all(is_retired));
        storage.try_close().unwrap();

        // Another scope's namespace under another epoch is still not ours.
        let database = TursoMemoryDatabase::new("schema-epoch-other.db");
        let storage = database.open("scope").unwrap();
        raw_execute(
            &storage,
            "UPDATE meta SET value = ?1 WHERE key = 'namespace'",
            vec![text(&previous_epoch_namespace("other"))],
        );
        storage.try_close().unwrap();
        assert_eq!(
            database.open("scope").unwrap_err().physical_reset_reason(),
            Some(PhysicalResetReason::Compatibility)
        );
    });
}

#[test]
fn an_unreadable_stored_schema_resets() {
    block_on(async {
        let storage = populate(TursoStorage::open_in_memory("schema-unreadable").unwrap()).await;
        raw_execute(
            &storage,
            "UPDATE cache_schema SET hash = 'other', incoming_hash = 'other', artifact = x'00'",
            vec![],
        );
        let adoption = adopt(&storage, OLD, &ProjectionInputs::none());
        assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Unreadable)));
        assert_eq!(count(&storage, "SELECT count(*) FROM records"), 1);
    });
}

#[test]
fn records_without_a_stored_schema_are_sorted_against_the_hint() {
    block_on(async {
        for (incoming, expected) in [
            (ADDED, Some(Tier::Compatible)),
            (RETYPED, types(&["Thing"], false)),
        ] {
            let mut storage = TursoStorage::open_in_memory("schema-unrecorded").unwrap();
            storage
                .put_batch(vec![(key("Thing:0"), record("thing"))])
                .await
                .unwrap();
            let adoption = storage
                .adopt_schema(
                    &schema(incoming),
                    &ProjectionInputs::none(),
                    Unrecorded::Known(schema(OLD)),
                )
                .unwrap();
            assert_eq!(adoption.change, expected, "{incoming}");
        }
    });
}

#[test]
fn records_the_host_cannot_say_the_writer_of_reset() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("schema-unrecorded-unreadable").unwrap();
        storage
            .put_batch(vec![(key("Thing:0"), record("thing"))])
            .await
            .unwrap();
        let adoption = storage
            .adopt_schema(
                &schema(OLD),
                &ProjectionInputs::none(),
                Unrecorded::Unreadable,
            )
            .unwrap();
        assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Unreadable)));
        assert_eq!(count(&storage, "SELECT count(*) FROM records"), 0);
    });
}

#[test]
fn a_second_build_on_one_engine_makes_the_next_open_sort() {
    block_on(async {
        let storage = populate(TursoStorage::open_in_memory("schema-several").unwrap()).await;
        let rows = rows_but_schema(&storage);
        storage.record_schema(&schema(OLD), &schema(OLD)).unwrap();
        assert_eq!(stored_incoming_hash(&storage), schema(OLD).hash());

        // Another webview's build added a field to the running engine.
        storage
            .record_schema(&schema(ADDED), &schema(ADDED))
            .unwrap();
        assert_eq!(stored_incoming_hash(&storage), "several-builds");
        let adoption = adopt(&storage, OLD, &ProjectionInputs::none());
        assert_eq!(adoption.change, Some(Tier::Compatible));
        assert!(adoption.schema.field_meta("Thing", "extra").is_some());
        assert_eq!(stored_incoming_hash(&storage), schema(OLD).hash());
        assert_eq!(rows_but_schema(&storage), rows);
    });
}

#[test]
fn a_storage_12_cache_upgrades_and_sorts_its_records_against_the_hint() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("cache.turso")).unwrap();
        let mut storage = populate(database.open("scope").unwrap()).await;
        let rows = rows_but_schema(&storage);
        test_hooks::rewrite_as_storage_12(&mut storage).unwrap();
        storage.try_close().unwrap();

        let storage = database.open("scope").unwrap();
        assert_eq!(storage.upgraded_from_storage_version(), Some(12));
        assert!(has_fresh_schema(&storage.connection()).unwrap());
        assert_eq!(count(&storage, "SELECT count(*) FROM cache_schema"), 0);
        assert_eq!(rows_but_schema(&storage), rows);
        let adoption = storage
            .adopt_schema(
                &schema(ADDED),
                &ProjectionInputs::none(),
                Unrecorded::Known(schema(OLD)),
            )
            .unwrap();
        assert_eq!(adoption.change, Some(Tier::Compatible));
        assert_eq!(rows_but_schema(&storage), rows);
        storage.try_close().unwrap();
    });
}

/// [`OLD`] with a calendar, whose records the calendar's derived rows read.
const CALENDARS: &str = "type Query { thing: Thing note: Note calendar: GraphqlCalendar } type Mutation { rename(id: ID!): Thing edit(id: ID!): Note } type Thing { id: ID! value: String } type Note { id: ID! value: String } type GraphqlCalendar { id: ID! name: String }";

/// Stores a calendar range and the coverage that says it holds the span.
fn cover_calendar(storage: &TursoStorage) {
    raw_execute(
        storage,
        "INSERT INTO calendar_ranges (record_key, event_key, link_id, kind, start, end, long) VALUES ('GraphqlCalendarOccurrence:1', 'GraphqlCalendarEvent:1', 'link', 0, 1, 2, 0)",
        Vec::new(),
    );
    raw_execute(
        storage,
        "INSERT INTO calendar_coverage (kind, start, end) VALUES (0, 0, 10)",
        Vec::new(),
    );
}

fn calendar_rows(storage: &TursoStorage) -> i64 {
    count(storage, "SELECT count(*) FROM calendar_ranges")
        + count(storage, "SELECT count(*) FROM calendar_coverage")
}

#[test]
fn a_store_derived_from_a_dropped_type_empties_with_its_coverage() {
    // Coverage that outlived its rows would read as complete and empty, and
    // the span would never be fetched again.
    let storage = TursoStorage::open_in_memory("scope").unwrap();
    assert_eq!(
        adopt(&storage, CALENDARS, &ProjectionInputs::none()).change,
        None
    );
    cover_calendar(&storage);

    // A change to a type no store derives from leaves the calendar whole.
    let unrelated = CALENDARS.replace(
        "type Thing { id: ID! value: String }",
        "type Thing { id: ID! value: Int }",
    );
    let adoption = adopt(&storage, &unrelated, &ProjectionInputs::none());
    assert_eq!(adoption.change, types(&["Thing"], false));
    assert_eq!(calendar_rows(&storage), 2);

    let retyped = unrelated.replace("name: String", "name: Int");
    let adoption = adopt(&storage, &retyped, &ProjectionInputs::none());
    let Some(Tier::Types { changed, .. }) = &adoption.change else {
        panic!("{:?}", adoption.change);
    };
    assert!(
        changed.contains(cache_core::calendar::CALENDAR_TYPENAME),
        "{changed:?}"
    );
    assert_eq!(calendar_rows(&storage), 0);

    cover_calendar(&storage);
    let roots = retyped.replace(
        "type Query {",
        "schema { query: Root mutation: Mutation } type Root {",
    );
    let adoption = adopt(&storage, &roots, &ProjectionInputs::none());
    assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Roots)));
    assert_eq!(calendar_rows(&storage), 0);
    storage.try_close().unwrap();
}
