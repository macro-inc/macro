//! Opening a cache with another build's GraphQL schema: each tier's effect
//! on records, derived rows, queued writes and the storage generation.
use super::*;
use crate::storage::migration::test_hooks;
use cache_core::engine::{
    BeginOptimisticWrite, CommitOptimisticWriteResult, Engine, IDENTITY_META_KEY,
    IDENTITY_VALUE_FIELD,
};
use cache_core::meta::Schema;
use cache_core::queue::{OptimisticSource, decode_optimistic_source, encode_optimistic_source};
use cache_core::schema_change::{ProjectionInputs, ResetReason, Tier, is_retired};
use cache_core::value::ROOT_QUERY;
use predicate_index::OptimisticProjectionMutation;

const OLD: &str = "type Query { thing: Thing note: Note } type Mutation { rename(id: ID!): Thing edit(id: ID!): Note } type Thing { id: ID! value: String } type Note { id: ID! value: String }";
/// [`OLD`] with a field added to `Thing`.
const ADDED: &str = "type Query { thing: Thing note: Note } type Mutation { rename(id: ID!): Thing edit(id: ID!): Note } type Thing { id: ID! value: String extra: Int } type Note { id: ID! value: String }";
/// [`OLD`] with `Thing.value` retyped.
const RETYPED: &str = "type Query { thing: Thing note: Note } type Mutation { rename(id: ID!): Thing edit(id: ID!): Note } type Thing { id: ID! value: Int } type Note { id: ID! value: String }";
/// [`OLD`] with `Thing.value` and `Note.value` retyped.
const BOTH_RETYPED: &str = "type Query { thing: Thing note: Note } type Mutation { rename(id: ID!): Thing edit(id: ID!): Note } type Thing { id: ID! value: Int } type Note { id: ID! value: Int }";
/// [`OLD`] with a field of the query root retyped.
const ROOT_RETYPED: &str = "type Query { thing: Note note: Note } type Mutation { rename(id: ID!): Thing edit(id: ID!): Note } type Thing { id: ID! value: String } type Note { id: ID! value: String }";
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
fn changed_types_drop_their_search_rows_together() {
    block_on(async {
        let storage = populate(TursoStorage::open_in_memory("schema-search-rows").unwrap()).await;
        for typename in ["Thing", "Note", "Kept"] {
            raw_execute(
                &storage,
                "INSERT INTO search_documents (profile, __typename, id, bucket, search_text, timestamp_ms, source_hash) VALUES ('quick-access', ?1, '1', 'bucket', 'text', 0, 'hash')",
                vec![text(typename)],
            );
        }
        let adoption = adopt(&storage, BOTH_RETYPED, &ProjectionInputs::none());
        assert_eq!(adoption.change, types(&["Note", "Thing"], false));
        let kept = driver::query(
            &storage.connection(),
            "SELECT __typename FROM search_documents ORDER BY __typename",
            vec![],
        )
        .unwrap()
        .iter()
        .map(|row| required_text(row, 0).unwrap())
        .collect::<Vec<_>>();
        assert_eq!(kept, ["Kept"]);
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
        // Any queued projection may hold facts the changed type fed, as the
        // build before derived them, so every one goes; the overlay of the
        // write returning a `Note` stays.
        let sources = sources(&mut storage).await;
        assert!(
            sources
                .iter()
                .all(|source| source.projection_mutations.is_empty())
        );
        assert!(!is_retired(&sources[1]));
        assert_eq!(
            count(&storage, "SELECT count(*) FROM optimistic_index_documents"),
            0
        );
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

/// A create that settled before the queued write after it: the write names
/// the note by its local key, an alias leads that key to the one the server
/// gave it, the note carries its coalescing UUID, and the write's shadow is
/// under the server key, as settlement leaves them.
async fn settle_a_create(storage: &mut TursoStorage) {
    let mut server = record("note");
    server.fields.insert(
        cache_core::identity::MUTATION_UUID_FIELD.into(),
        cache_core::value::CacheValue::String("created".into()),
    );
    storage
        .put_batch(vec![
            (
                key("Note:local"),
                cache_core::identity::alias_record(&key("Note:server")),
            ),
            (key("Note:server"), server),
        ])
        .await
        .unwrap();
    storage
        .enqueue_mutation(pending(
            "EditCreated",
            "mutation EditCreated { edit(id: \"local\") { id value } }",
            serde_json::json!({ "edit": { "id": "local", "value": "edited" } }),
            &["Note:local"],
        ))
        .await
        .unwrap();
    let owner = storage.load_mutation_queue().await.unwrap()[2].id;
    put_shadow(storage, "Note:server", owner).await;
}

/// Writes the index shadow `owner`'s queued write gives `key`, as
/// settlement composes it where it moved the write's projection.
async fn put_shadow(storage: &mut TursoStorage, key: &str, owner: MutationId) {
    let record_key = PredicateRecordKey::new(key).unwrap();
    let mutations = [OptimisticProjectionMutation::Replace(
        authoritative_projection(key, "queued"),
    )];
    let shadow = cache_core::predicate::compose_effective_optimistic_projection(
        &record_key,
        None,
        &[cache_core::predicate::ProjectionMutationLayer {
            owner,
            mutations: &mutations,
        }],
    )
    .unwrap()
    .unwrap();
    storage
        .replace_optimistic_layers(&[], &[record_key], &[shadow])
        .await
        .unwrap();
}

fn shadows(storage: &TursoStorage, key: &str) -> i64 {
    count(
        storage,
        &format!("SELECT count(*) FROM optimistic_index_documents WHERE record_key = '{key}'"),
    )
}

#[test]
fn a_dropped_records_shadow_under_its_server_key_goes_and_its_identity_stays() {
    block_on(async {
        for (sdl, inputs, change) in [
            (
                BOTH_RETYPED,
                ProjectionInputs::none(),
                types(&["Note", "Thing"], false),
            ),
            (
                RETYPED,
                ProjectionInputs::none().nested("Thing", &["value"]),
                types(&["Thing"], true),
            ),
            (
                ROOTS,
                ProjectionInputs::none(),
                Some(Tier::Reset(ResetReason::Roots)),
            ),
        ] {
            let mut storage =
                populate(TursoStorage::open_in_memory("schema-settled-dropped").unwrap()).await;
            settle_a_create(&mut storage).await;

            assert_eq!(adopt(&storage, sdl, &inputs).change, change);
            assert_eq!(shadows(&storage, "Note:server"), 0, "{change:?}");
            assert_eq!(shadows(&storage, "Note:local"), 0, "{change:?}");
            // The alias and the coalescing UUID stay for the queued write's
            // settlement; a dropped note keeps nothing else.
            let records = storage
                .get_batch(&[key("Note:local"), key("Note:server")])
                .await
                .unwrap();
            assert_eq!(
                records[0],
                Some(cache_core::identity::alias_record(&key("Note:server")))
            );
            let server = records[1].as_ref().unwrap();
            assert!(
                server
                    .fields
                    .contains_key(cache_core::identity::MUTATION_UUID_FIELD)
            );
            assert_eq!(
                server.fields.contains_key("value"),
                change == types(&["Thing"], true),
                "{change:?}"
            );
        }
    });
}

#[test]
fn a_kept_records_shadow_under_its_server_key_is_composed_there() {
    block_on(async {
        let mut storage =
            populate(TursoStorage::open_in_memory("schema-settled-kept").unwrap()).await;
        settle_a_create(&mut storage).await;

        let adoption = adopt(&storage, RETYPED, &ProjectionInputs::none());
        assert_eq!(adoption.change, types(&["Thing"], false));
        assert_eq!(adoption.retired_overlays, 1);
        // The write still fits: its shadow is composed again where
        // settlement put it, not under the key its source names.
        assert_eq!(shadows(&storage, "Note:server"), 1);
        assert_eq!(shadows(&storage, "Note:local"), 0);
        assert!(!is_retired(&sources(&mut storage).await[2]));
    });
}

/// Queues an edit of `Note:local` that binds `Thing:local`, a settled create
/// aliased to `Thing:server`, and says `Note` records share its ID. Returns
/// the edit's queue ID.
async fn queue_a_related_edit(storage: &mut TursoStorage) -> MutationId {
    storage
        .put_batch(vec![
            (
                key("Thing:local"),
                cache_core::identity::alias_record(&key("Thing:server")),
            ),
            (key("Thing:server"), record("thing")),
        ])
        .await
        .unwrap();
    let mut edit = pending(
        "EditPreview",
        "mutation EditPreview { edit(id: \"local\") { id value } }",
        serde_json::json!({ "edit": { "id": "local", "value": "edited" } }),
        &["Note:local"],
    );
    let mut source = decode_optimistic_source(&edit.optimistic.optimistic_data_json).unwrap();
    source.identity_bindings = vec![cache_core::identity::IdentityBinding {
        local_key: key("Thing:local"),
        delete_record: false,
        response_path: Vec::new(),
        reference_fields: vec!["Note.id".into()],
        revalidation_variables: Vec::new(),
    }];
    edit.optimistic.optimistic_data_json = encode_optimistic_source(&source);
    storage.enqueue_mutation(edit).await.unwrap();
    storage.load_mutation_queue().await.unwrap()[2].id
}

#[test]
fn a_shadow_moved_to_a_related_records_server_key_is_composed_there() {
    block_on(async {
        let mut storage =
            populate(TursoStorage::open_in_memory("schema-related-identity").unwrap()).await;
        // A settled create aliased its own record; a later write that binds
        // it names a record sharing its ID, whose shadow settlement moved.
        let owner = queue_a_related_edit(&mut storage).await;
        put_shadow(&mut storage, "Note:server", owner).await;

        let adoption = adopt(&storage, RETYPED, &ProjectionInputs::none());
        assert_eq!(adoption.change, types(&["Thing"], false));
        assert_eq!(shadows(&storage, "Note:server"), 1);
        assert_eq!(shadows(&storage, "Note:local"), 0);
    });
}

#[test]
fn a_related_records_tombstone_under_its_server_key_stays() {
    // Dropping the related record's type keeps it, and so does a Reset.
    for (scope, sdl) in [
        ("schema-related-tombstone-types", BOTH_RETYPED),
        ("schema-related-tombstone-reset", ROOTS),
    ] {
        block_on(async {
            let mut storage = populate(TursoStorage::open_in_memory(scope).unwrap()).await;
            queue_a_related_edit(&mut storage).await;
            let mut tombstone = record("note");
            tombstone.fields.insert(
                cache_core::identity::DELETED_FIELD.into(),
                cache_core::value::CacheValue::Bool(true),
            );
            storage
                .put_batch(vec![(key("Note:server"), tombstone)])
                .await
                .unwrap();

            adopt(&storage, sdl, &ProjectionInputs::none());
            let kept = storage.get_batch(&[key("Note:server")]).await.unwrap();
            assert_eq!(
                kept[0]
                    .as_ref()
                    .and_then(|record| record.fields.get(cache_core::identity::DELETED_FIELD)),
                Some(&cache_core::value::CacheValue::Bool(true)),
                "{scope}"
            );
        });
    }
}
#[test]
fn a_changed_query_root_drops_its_document_and_shadow() {
    block_on(async {
        let mut storage =
            populate(TursoStorage::open_in_memory("schema-root-document").unwrap()).await;
        storage
            .put_batch_with_projections(
                vec![(key(ROOT_QUERY), record("root"))],
                vec![ProjectionMutation::Replace(authoritative_projection(
                    ROOT_QUERY, "owner",
                ))],
            )
            .await
            .unwrap();
        let owner = storage.load_mutation_queue().await.unwrap()[0].id;
        put_shadow(&mut storage, ROOT_QUERY, owner).await;
        assert!(facts(&storage, ROOT_QUERY) > 0);

        let adoption = adopt(&storage, ROOT_RETYPED, &ProjectionInputs::none());
        assert_eq!(adoption.change, types(&[ROOT_QUERY], false));
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM index_documents WHERE record_key = 'ROOT_QUERY'"
            ),
            0
        );
        assert_eq!(facts(&storage, ROOT_QUERY), 0);
        assert_eq!(shadows(&storage, ROOT_QUERY), 0);
        // The other types' documents stay.
        assert!(facts(&storage, "Thing:0") > 0);
        assert!(facts(&storage, "Note:0") > 0);
    });
}

#[test]
fn a_type_named_like_the_query_root_drops_its_documents_with_its_records() {
    block_on(async {
        let old =
            "type Query { mode: String one: ROOT_QUERY } type ROOT_QUERY { id: ID! value: String }";
        let mut storage = TursoStorage::open_in_memory("schema-root-named-type").unwrap();
        storage
            .adopt_schema(&schema(old), &ProjectionInputs::none(), Unrecorded::Guess)
            .unwrap();
        storage
            .put_batch_with_projections(
                vec![(key("ROOT_QUERY:one"), record("one"))],
                vec![ProjectionMutation::Replace(authoritative_projection(
                    "ROOT_QUERY:one",
                    "owner",
                ))],
            )
            .await
            .unwrap();
        assert!(facts(&storage, "ROOT_QUERY:one") > 0);

        // Retyping a query root field drops the records of that typename.
        let adoption = adopt(
            &storage,
            &old.replace("mode: String", "mode: Int"),
            &ProjectionInputs::none(),
        );
        assert_eq!(adoption.change, types(&[ROOT_QUERY], false));
        assert_eq!(
            storage.get_batch(&[key("ROOT_QUERY:one")]).await.unwrap(),
            vec![None]
        );
        assert_eq!(
            count(
                &storage,
                "SELECT count(*) FROM index_documents WHERE record_key = 'ROOT_QUERY:one'"
            ),
            0
        );
        assert_eq!(facts(&storage, "ROOT_QUERY:one"), 0);
    });
}

#[test]
fn a_write_whose_response_the_new_schema_cannot_hold_settles_with_its_identity() {
    block_on(async {
        // A projection reads `label`, so dropping it changes `Saved`.
        let old = schema(
            "type Query { saved: Saved } type Mutation { save: Saved } type Saved { id: ID! label: String }",
        );
        let new = schema(
            "type Query { saved: Saved } type Mutation { save: Saved } type Saved { id: ID! revision: Int }",
        );
        let inputs = ProjectionInputs::none().own("Saved", &["label"]);
        let storage = TursoStorage::open_in_memory("schema-unwritable-response").unwrap();
        storage
            .adopt_schema(&old, &inputs, Unrecorded::Guess)
            .unwrap();
        let mut engine = Engine::with_schema(storage, 32, old);
        let query = "mutation Save { save { __typename id label } }";
        let variables = serde_json::Map::new();
        // A create: the server gives the record its ID.
        let bindings = [cache_core::identity::IdentityBinding {
            local_key: key("Saved:local"),
            delete_record: false,
            response_path: vec!["save".into()],
            reference_fields: Vec::new(),
            revalidation_variables: Vec::new(),
        }];
        let (transaction, _) = engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    client_metadata: None,
                    identity_bindings: &bindings,
                    uuid: "11111111-1111-4111-8111-111111111111",
                    query,
                    operation_name: None,
                    variables: &variables,
                    data: &serde_json::json!({
                        "save": { "__typename": "Saved", "id": "local", "label": "pending" }
                    }),
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 0,
                },
            )
            .await
            .unwrap();
        let storage = engine.into_storage();
        let adoption = storage
            .adopt_schema(&new, &inputs, Unrecorded::Guess)
            .unwrap();
        assert_eq!(adoption.change, types(&["Saved"], false));
        assert_eq!(adoption.retired_overlays, 1);

        // A server still on the older schema answers with the dropped field.
        let mut engine = Engine::with_schema(storage, 32, adoption.schema);
        let claimed = engine
            .claim_next_mutation(MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 1,
                lease_expires_at_ms: 100,
            })
            .await
            .unwrap()
            .unwrap();
        let outcome = engine
            .commit_optimistic_write_with_outcome(
                transaction,
                MutationClaimToken {
                    owner: "runner".into(),
                    generation: claimed.lease_generation,
                },
                query,
                None,
                &variables,
                &serde_json::json!({
                    "save": { "__typename": "Saved", "id": "9", "label": "accepted" }
                }),
            )
            .await
            .unwrap();
        // It settles without its content, so the queue moves on, and keeps
        // the ID the server gave it for the writes that name the local one.
        let CommitOptimisticWriteResult::Committed(result) = outcome else {
            panic!("settles: {outcome:?}");
        };
        assert_eq!(result.identity_errors.len(), 1, "{result:?}");
        assert!(
            engine
                .storage()
                .load_mutation_queue()
                .await
                .unwrap()
                .is_empty()
        );
        let records = engine
            .storage()
            .get_batch(&[key("Saved:local"), key("Saved:9")])
            .await
            .unwrap();
        assert_eq!(
            records[0],
            Some(cache_core::identity::alias_record(&key("Saved:9")))
        );
        let server = records[1].as_ref().unwrap();
        assert!(
            server
                .fields
                .contains_key(cache_core::identity::MUTATION_UUID_FIELD)
        );
        assert!(!server.fields.contains_key("label"));
        assert_eq!(
            server.fields.get("id"),
            Some(&cache_core::value::CacheValue::String("9".into()))
        );
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

/// Every table of a fresh file is one a schema change drops with the records
/// it derives from, or one every tier keeps. A store that adds tables says
/// which: a table no list names would keep rows a reset or a changed type
/// should have taken.
#[test]
fn every_table_is_derived_shadow_or_kept() {
    let storage = TursoStorage::open_in_memory("schema-table-classes").unwrap();
    let kept = [
        "cache_schema",
        "meta",
        "mutation_queue",
        "optimistic_layers",
        "records",
    ];
    let named = crate::storage::schema_store::DERIVED_TABLES
        .iter()
        .chain(&crate::storage::schema_store::SHADOW_TABLES)
        .chain(
            crate::storage::schema_store::DERIVED_STORES
                .iter()
                .flat_map(|store| store.tables),
        )
        .chain(&kept)
        .copied()
        .collect::<std::collections::BTreeSet<_>>();
    let unnamed = driver::query(
        &storage.connection(),
        "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__turso_internal%' ORDER BY name",
        vec![],
    )
    .unwrap()
    .iter()
    .map(|row| required_text(row, 0).unwrap())
    .filter(|table| !named.contains(table.as_str()))
    .collect::<Vec<_>>();
    assert!(unnamed.is_empty(), "tables no tier names: {unnamed:?}");
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
    /// The statement the Types tier drops a changed type's records with.
    const RECORDS_DELETE: &str = "DELETE FROM records WHERE __typename = ?1";
    // A statement that fails, or storage that fills up partway, rolls the
    // tier back, and dropping every record takes its place.
    for (name, error) in [
        ("statement", TursoStorageError::Database),
        (
            "storage-full",
            TursoStorageError::PhysicalResetRequired(PhysicalResetReason::StorageFull),
        ),
    ] {
        block_on(async {
            let database = TursoMemoryDatabase::new(format!("schema-failed-{name}.db"));
            let mut storage = populate(database.open("scope").unwrap()).await;
            driver::arm_statement_failure(RECORDS_DELETE, error);
            let adoption = adopt(&storage, RETYPED, &ProjectionInputs::every());
            assert_eq!(
                adoption.change,
                Some(Tier::Reset(ResetReason::Failed)),
                "case {name}"
            );
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
            storage.try_close().unwrap();

            // The file opens again as it was left, with its queue.
            let storage = database.open("scope").unwrap();
            assert_eq!(
                adopt(&storage, RETYPED, &ProjectionInputs::every()).change,
                None
            );
            assert_eq!(
                storage.load_mutation_queue().await.unwrap().len(),
                2,
                "case {name}"
            );
        });
    }

    // A file whose state is in doubt is replaced, not reset in place.
    block_on(async {
        let storage =
            populate(TursoStorage::open_in_memory("schema-failed-corrupt").unwrap()).await;
        driver::arm_statement_failure(
            RECORDS_DELETE,
            TursoStorageError::PhysicalResetRequired(PhysicalResetReason::Corruption),
        );
        let error = storage
            .adopt_schema(
                &schema(RETYPED),
                &ProjectionInputs::every(),
                Unrecorded::Guess,
            )
            .unwrap_err();
        assert_eq!(
            error.physical_reset_reason(),
            Some(PhysicalResetReason::Corruption)
        );
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

        // A file of another epoch at the previous cache format moves to both
        // in one open, and keeps its queue too.
        let database = TursoMemoryDatabase::new("schema-epoch-format.db");
        let storage = populate(database.open("scope").unwrap()).await;
        let previous = cache_core::codec::MIGRATABLE_CACHE_FORMAT_VERSIONS[0];
        mark_previous_format(
            &storage,
            &format!(
                "graphql-cache:scope:s{}:v{previous}",
                cache_core::codec::CACHE_SCHEMA_COMPATIBILITY_EPOCH - 1
            ),
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
fn a_previous_formats_cache_keeps_its_identity_authority_and_aliases() {
    block_on(async {
        let database = TursoMemoryDatabase::new("schema-previous-format.db");
        let mut storage = populate(database.open("scope").unwrap()).await;
        let mut authority = Record::default();
        authority.fields.insert(
            "value".into(),
            cache_core::value::CacheValue::String("granted".into()),
        );
        storage
            .put_batch(vec![(key("__meta:authority"), authority.clone())])
            .await
            .unwrap();
        settle_a_create(&mut storage).await;
        let kept = [
            key(IDENTITY_META_KEY),
            key("__meta:authority"),
            key("Note:local"),
        ];
        let before = storage.get_batch(&kept).await.unwrap();
        let commands = storage
            .load_mutation_queue()
            .await
            .unwrap()
            .into_iter()
            .map(|queued| (queued.id, queued.mutation.request))
            .collect::<Vec<_>>();
        mark_previous_format(
            &storage,
            &cache_namespace_at(
                "scope",
                cache_core::codec::MIGRATABLE_CACHE_FORMAT_VERSIONS[0],
            ),
        );
        storage.try_close().unwrap();

        // The open rewrites what a reset keeps in this format, and the
        // adoption after it resets the rest.
        let mut storage = database.open("scope").unwrap();
        assert_eq!(storage.get_batch(&kept).await.unwrap(), before);
        assert_eq!(count(&storage, "SELECT count(*) FROM records"), 4);
        let adoption = adopt(&storage, OLD, &ProjectionInputs::none());
        assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Unreadable)));
        assert_eq!(storage.get_batch(&kept).await.unwrap(), before);
        let server = storage.get_batch(&[key("Note:server")]).await.unwrap();
        let server = server[0].as_ref().unwrap();
        assert!(
            server
                .fields
                .contains_key(cache_core::identity::MUTATION_UUID_FIELD)
        );
        assert!(!server.fields.contains_key("value"));
        assert_eq!(shadows(&storage, "Note:server"), 0);
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
        storage.try_close().unwrap();
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

        // A row holding a value of a type no build writes reads the same.
        let storage = populate(TursoStorage::open_in_memory("schema-mistyped").unwrap()).await;
        raw_execute(
            &storage,
            "UPDATE cache_schema SET artifact = 'schema'",
            vec![],
        );
        let adoption = adopt(&storage, ADDED, &ProjectionInputs::none());
        assert_eq!(adoption.change, Some(Tier::Reset(ResetReason::Unreadable)));
        assert_eq!(count(&storage, "SELECT count(*) FROM records"), 1);
        assert_eq!(count(&storage, "SELECT count(*) FROM mutation_queue"), 2);
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
