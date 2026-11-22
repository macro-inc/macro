#![cfg(not(target_arch = "wasm32"))]

use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use cache_core::search::{SearchProfile, SearchRequest};
use cache_core::store::Storage;
use cache_core::value::{CacheValue, EntityKey, Record};
use cache_turso::{TursoFileDatabase, TursoMemoryDatabase};
use pollster::block_on;
use serde_json::json;

const QUERY: &str = "query { user { id emailThread(id: \"thread\") { __typename id emailName: name snippet messages { __typename id bodyText } } } }";
const MUTATION: &str = "mutation Save($input: SaveEmailDraftInput!) { saveEmailDraft(input: $input) { thread { __typename id emailName: name snippet messages { __typename id bodyText } } } }";

#[test]
fn permission_retirement_preserves_reply_command_without_restoring_original_thread() {
    block_on(async {
        let database = TursoMemoryDatabase::new("permission-retirement.db");
        let mut storage = database.open("viewer").unwrap();
        let alias = EntityKey("GraphqlSoupEmailThread:local-thread".into());
        let target = EntityKey("GraphqlSoupEmailThread:thread".into());
        storage
            .put_batch(vec![(
                alias.clone(),
                cache_core::identity::alias_record(&target),
            )])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        let thread = json!({"__typename":"GraphqlSoupEmailThread","id":"thread","emailName":"private subject","snippet":"private snippet","messages":[{"__typename":"GraphqlSoupEmailMessage","id":"original","bodyText":"private original message"}]});
        engine
            .write_query(
                None,
                QUERY,
                None,
                &Default::default(),
                &json!({"user":{"id":"viewer","emailThread":thread}}),
                None,
            )
            .await
            .unwrap();
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    task_dependency_recipe: None,
                    uuid: "00000000-0000-4000-8000-000000000001",
                    client_metadata: Some(&json!({"draftRevision":4})),
                    query: MUTATION,
                    operation_name: Some("Save"),
                    variables: json!({"input":{"threadId":"thread","bodyText":"my pending reply"}})
                        .as_object()
                        .unwrap(),
                    data: &json!({"saveEmailDraft":{"thread":thread}}),
                    link_patches: &[],
                    revalidations: &[],
                    identity_bindings: &[cache_core::identity::IdentityBinding {
                        local_key: alias.clone(),
                        response_path: vec![],
                        delete_record: false,
                        reference_fields: vec!["GraphqlSoupEmailMessage.threadId".into()],
                        revalidation_variables: vec!["threadId".into()],
                    }],
                    created_at_ms: 10,
                },
            )
            .await
            .unwrap();
        let before = engine.storage().load_mutation_queue().await.unwrap();
        let key = EntityKey("GraphqlSoupEmailThread:thread".into());
        let before_authority = engine.current_authority("viewer").await.unwrap();
        let retiring = engine
            .begin_authority_transition(
                "viewer",
                before_authority.generation,
                "team:denied".into(),
                true,
            )
            .await
            .unwrap();
        let removable = engine
            .preserve_identity_metadata(vec![alias.clone(), key.clone()])
            .await
            .unwrap();
        assert_eq!(removable, vec![key]);
        engine
            .delete_keys_with_projections(&removable, &[])
            .await
            .unwrap();
        assert!(
            matches!(
                engine
                    .read_query(None, QUERY, None, &Default::default())
                    .await
                    .unwrap(),
                ReadResult::Hit { .. }
            ),
            "the queued response still supplies the removed base"
        );
        engine
            .retire_optimistic_snapshots_where(|entry, _source| {
                entry
                    .optimistic
                    .normalized_updates
                    .keys()
                    .any(|key| key.typename() == Some("GraphqlSoupEmailThread"))
            })
            .await
            .unwrap();
        assert!(matches!(
            engine
                .read_query(None, QUERY, None, &Default::default())
                .await
                .unwrap(),
            ReadResult::Miss
        ));
        engine
            .complete_authority_transition(retiring)
            .await
            .unwrap();
        let after = engine.storage().load_mutation_queue().await.unwrap();
        assert_eq!(before[0].mutation, after[0].mutation);
        assert_eq!(before[0].uuid, after[0].uuid);
        assert_eq!(before[0].id, after[0].id);
        assert!(!after[0].optimistic.optimistic_data_json.contains("private"));
        assert!(
            after[0]
                .mutation
                .request
                .variables_json
                .contains("my pending reply")
        );
        let storage = engine.into_storage();
        storage.try_close().unwrap();
        let mut engine = Engine::new(database.open("viewer").unwrap());
        assert!(matches!(
            engine
                .read_query(None, QUERY, None, &Default::default())
                .await
                .unwrap(),
            ReadResult::Miss
        ));
        let search = engine
            .search(&SearchRequest {
                profile: SearchProfile::QuickAccessV1,
                buckets: vec!["email".into()],
                query: "private".into(),
                cursor: None,
                limit: 50,
                now_ms: 100,
            })
            .await
            .unwrap();
        assert!(search.documents.is_empty());
        assert_eq!(
            engine.storage().load_mutation_queue().await.unwrap()[0].mutation,
            before[0].mutation
        );
        let alias_record = engine.storage().get_batch(&[alias]).await.unwrap();
        assert_eq!(
            cache_core::identity::alias_target(alias_record[0].as_ref().unwrap()),
            Some(&target)
        );
    });
}

#[test]
#[ignore = "100k-record permission retirement measurement; run explicitly"]
fn retire_100k_cached_records_in_bounded_pages() {
    block_on(async {
        let directory = tempfile::tempdir().unwrap();
        let database = TursoFileDatabase::new(directory.path().join("retirement.turso")).unwrap();
        let mut storage = database.open("viewer").unwrap();
        for batch in 0..200 {
            storage
                .put_batch(
                    (0..500)
                        .map(|offset| {
                            let id = format!("{:06}", batch * 500 + offset);
                            (
                                EntityKey::entity("GraphqlSoupCrmContact", &[&id]),
                                Record {
                                    fields: [
                                        (
                                            "__typename".into(),
                                            CacheValue::String("GraphqlSoupCrmContact".into()),
                                        ),
                                        (
                                            "name".into(),
                                            CacheValue::String(format!("Contact {id}")),
                                        ),
                                    ]
                                    .into(),
                                },
                            )
                        })
                        .collect(),
                )
                .await
                .unwrap();
        }
        let mut engine = Engine::new(storage);
        let started = std::time::Instant::now();
        engine
            .retire_optimistic_snapshots_where(|entry, _source| {
                entry
                    .optimistic
                    .normalized_updates
                    .keys()
                    .any(|key| key.typename() == Some("GraphqlSoupCrmContact"))
            })
            .await
            .unwrap();
        let mut count = 0;
        let mut after = None;
        loop {
            let keys = engine
                .storage()
                .record_keys("GraphqlSoupCrmContact", after.as_deref(), 500)
                .await
                .unwrap();
            if keys.is_empty() {
                break;
            }
            after = keys.last().and_then(|key| key.id()).map(str::to_owned);
            count += keys.len();
            engine
                .delete_keys_with_projections(&keys, &[])
                .await
                .unwrap();
        }
        assert_eq!(count, 100_000);
        eprintln!(
            "retired {count} cached records in {:?}, max page500",
            started.elapsed()
        );
    });
}
