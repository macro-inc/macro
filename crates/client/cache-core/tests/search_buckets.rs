use cache_core::engine::{BeginOptimisticWrite, Engine};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::search::{SearchProfile, SearchRequest};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey, Record};
use serde_json::json;

fn record(typename: &str, name: &str, note: bool) -> Record {
    let mut record = Record {
        fields: [
            ("__typename".into(), CacheValue::String(typename.into())),
            ("name".into(), CacheValue::String(name.into())),
        ]
        .into(),
    };
    if note {
        record
            .fields
            .insert("fileType".into(), CacheValue::String("md".into()));
    }
    record
}
fn request(buckets: &[&str]) -> SearchRequest {
    SearchRequest {
        profile: SearchProfile::QuickAccessV1,
        buckets: buckets.iter().map(|b| (*b).into()).collect(),
        query: "needle".into(),
        limit: 20,
        cursor: None,
        now_ms: 1_000,
    }
}
async fn patch(
    engine: &mut Engine<InMemoryStorage>,
    key: &EntityKey<'static>,
    fields: &[(&str, CacheValue)],
) {
    engine
        .put_records_with_projections(
            None,
            vec![(
                key.clone(),
                Record {
                    fields: fields
                        .iter()
                        .map(|(k, v)| ((*k).into(), v.clone()))
                        .collect(),
                },
            )],
            vec![],
        )
        .await
        .unwrap();
}

#[test]
fn only_requested_buckets_load_and_empty_buckets_are_cached() {
    pollster::block_on(async {
        let mut storage = InMemoryStorage::new();
        let mut entries: Vec<_> = (0..1_000)
            .map(|i| {
                (
                    EntityKey::entity("GraphqlSoupEmailThread", &[&i.to_string()]),
                    record("GraphqlSoupEmailThread", "needle mail", false),
                )
            })
            .collect();
        entries.push((
            EntityKey::entity("GraphqlSoupDocument", &["note"]),
            record("GraphqlSoupDocument", "needle note", true),
        ));
        entries.push((
            EntityKey::entity("GraphqlSoupDocument", &["doc"]),
            record("GraphqlSoupDocument", "needle doc", false),
        ));
        storage.put_batch(entries).await.unwrap();
        let diagnostics = storage.clone();
        let mut engine = Engine::new(storage);
        for _ in 0..2 {
            assert_eq!(
                engine
                    .search(&request(&["note", "note"]))
                    .await
                    .unwrap()
                    .documents
                    .len(),
                1
            );
        }
        assert_eq!(diagnostics.search_catalog_load_count(), 1);
        assert_eq!(diagnostics.search_catalog_rows_loaded(), 1);
        for _ in 0..2 {
            assert!(
                engine
                    .search(&request(&["task", "unknown"]))
                    .await
                    .unwrap()
                    .documents
                    .is_empty()
            );
        }
        assert_eq!(diagnostics.search_catalog_load_count(), 2);
        assert_eq!(
            engine
                .search(&request(&["document", "note"]))
                .await
                .unwrap()
                .documents
                .len(),
            2
        );
        assert_eq!(diagnostics.search_catalog_load_count(), 3);
        assert_eq!(diagnostics.search_catalog_rows_loaded(), 2);
        assert_eq!(diagnostics.record_get_count(), 0);
        assert_eq!(
            engine.search(&request(&[])).await.unwrap().documents.len(),
            20
        );
        assert_eq!(
            diagnostics.search_catalog_load_count(),
            SearchProfile::QuickAccessV1.buckets().len()
        );
        assert_eq!(diagnostics.search_catalog_rows_loaded(), 1_002);
    });
}

#[test]
fn loaded_catalogs_handle_moves_hiding_deletion_and_external_invalidation() {
    pollster::block_on(async {
        let key = EntityKey::entity("GraphqlSoupDocument", &["doc"]);
        let mut storage = InMemoryStorage::new();
        storage
            .put_batch(vec![(
                key.clone(),
                record("GraphqlSoupDocument", "needle", false),
            )])
            .await
            .unwrap();
        let mut engine = Engine::new(storage);
        for buckets in [vec!["document"], vec!["note"]] {
            engine.search(&request(&buckets)).await.unwrap();
        }
        patch(
            &mut engine,
            &key,
            &[("fileType", CacheValue::String("md".into()))],
        )
        .await;
        assert!(
            engine
                .search(&request(&["document"]))
                .await
                .unwrap()
                .documents
                .is_empty()
        );
        assert_eq!(
            engine
                .search(&request(&["note"]))
                .await
                .unwrap()
                .documents
                .len(),
            1
        );
        patch(&mut engine, &key, &[("hidden", CacheValue::Bool(true))]).await;
        assert!(
            engine
                .search(&request(&["note"]))
                .await
                .unwrap()
                .documents
                .is_empty()
        );
        patch(&mut engine, &key, &[("hidden", CacheValue::Bool(false))]).await;
        assert_eq!(
            engine
                .search(&request(&["note"]))
                .await
                .unwrap()
                .documents
                .len(),
            1
        );
        engine.invalidate_keys([&key]).unwrap();
        assert_eq!(
            engine
                .search(&request(&["note"]))
                .await
                .unwrap()
                .documents
                .len(),
            1
        );
        engine.delete_keys(&[key]).await.unwrap();
        assert!(
            engine
                .search(&request(&["note"]))
                .await
                .unwrap()
                .documents
                .is_empty()
        );
        engine.clear().await.unwrap();
        assert!(
            engine
                .search(&request(&[]))
                .await
                .unwrap()
                .documents
                .is_empty()
        );
    });
}

#[test]
fn moving_to_an_unloaded_bucket_does_not_mark_its_other_rows_loaded() {
    pollster::block_on(async {
        let moved = EntityKey::entity("GraphqlSoupDocument", &["moved"]);
        let other = EntityKey::entity("GraphqlSoupDocument", &["existing-note"]);
        let mut storage = InMemoryStorage::new();
        storage
            .put_batch(vec![
                (
                    moved.clone(),
                    record("GraphqlSoupDocument", "needle", false),
                ),
                (other, record("GraphqlSoupDocument", "needle", true)),
            ])
            .await
            .unwrap();
        let diagnostics = storage.clone();
        let mut engine = Engine::new(storage);
        engine.search(&request(&["document"])).await.unwrap();
        patch(
            &mut engine,
            &moved,
            &[("fileType", CacheValue::String("md".into()))],
        )
        .await;
        assert_eq!(
            engine
                .search(&request(&["note"]))
                .await
                .unwrap()
                .documents
                .len(),
            2
        );
        assert_eq!(diagnostics.search_catalog_load_count(), 2);
    });
}

#[test]
fn optimistic_bucket_moves_overlay_borrowed_catalogs_through_settlement() {
    pollster::block_on(async {
        for commit in [false, true] {
            let key = EntityKey::entity("GraphqlSoupDocument", &["doc"]);
            let mut storage = InMemoryStorage::new();
            storage
                .put_batch(vec![(key, record("GraphqlSoupDocument", "needle", false))])
                .await
                .unwrap();
            let mut engine = Engine::new(storage);
            engine
                .search(&request(&["document", "note"]))
                .await
                .unwrap();
            let variables = serde_json::Map::new();
            let mutation = include_str!("fixtures/search_move.graphql");
            let response = json!({"renameEntities":{"results":[{"__typename":"GraphqlMutationSuccess","effects":[{"__typename":"SoupUpdated","item":{"__typename":"GraphqlSoupDocument","id":"doc","name":"needle","fileType":"md"}}]}]}});
            let (id, _) = engine
                .begin_optimistic_write(
                    None,
                    BeginOptimisticWrite {
                        uuid: "00000000-0000-4000-8000-000000000001",
                        query: mutation,
                        operation_name: None,
                        variables: &variables,
                        data: &response,
                        link_patches: &[],
                        revalidations: &[],
                        created_at_ms: 1,
                    },
                )
                .await
                .unwrap();
            assert!(
                engine
                    .search(&request(&["document"]))
                    .await
                    .unwrap()
                    .documents
                    .is_empty()
            );
            assert_eq!(
                engine
                    .search(&request(&["note"]))
                    .await
                    .unwrap()
                    .documents
                    .len(),
                1
            );
            assert_eq!(
                engine
                    .search(&request(&["document", "note"]))
                    .await
                    .unwrap()
                    .documents
                    .len(),
                1
            );
            let claimed = engine
                .claim_next_mutation(MutationClaimRequest {
                    owner: "test".into(),
                    now_ms: 2,
                    lease_expires_at_ms: 100,
                })
                .await
                .unwrap()
                .unwrap();
            let claim = MutationClaimToken {
                owner: "test".into(),
                generation: claimed.lease_generation,
            };
            if commit {
                engine
                    .commit_optimistic_write(id, claim, mutation, None, &variables, &response)
                    .await
                    .unwrap();
            } else {
                engine.rollback_optimistic_write(id, claim).await.unwrap();
            }
            assert_eq!(
                engine
                    .search(&request(&["document"]))
                    .await
                    .unwrap()
                    .documents
                    .len(),
                usize::from(!commit)
            );
            assert_eq!(
                engine
                    .search(&request(&["note"]))
                    .await
                    .unwrap()
                    .documents
                    .len(),
                usize::from(commit)
            );
        }
    });
}

#[test]
fn bounded_browse_preserves_cross_bucket_cursor_order_and_ties() {
    pollster::block_on(async {
        let entries: Vec<_> = (0..17)
            .map(|i| {
                let key = EntityKey::entity("GraphqlSoupDocument", &[&format!("d{i:02}")]);
                let mut value = record("GraphqlSoupDocument", "needle", i % 2 == 0);
                value.fields.insert(
                    "updatedAt".into(),
                    CacheValue::Number(cache_core::value::CacheNumber::PosInt(i / 3)),
                );
                (key, value)
            })
            .collect();
        let mut expected: Vec<_> = entries
            .iter()
            .flat_map(|(key, record)| cache_core::search::project_search_documents(key, record))
            .collect();
        expected.sort_by(cache_core::search::compare_recent);
        let mut storage = InMemoryStorage::new();
        storage.put_batch(entries).await.unwrap();
        let diagnostics = storage.clone();
        let mut engine = Engine::new(storage);
        let mut req = request(&["document", "note"]);
        req.query.clear();
        req.limit = 3;
        let mut actual = Vec::new();
        for _ in 0..10 {
            let page = engine.search(&req).await.unwrap();
            actual.extend(page.documents);
            req.cursor = page.next_cursor;
            if req.cursor.is_none() {
                break;
            }
        }
        assert_eq!(actual, expected);
        assert_eq!(diagnostics.search_catalog_load_count(), 0);
    });
}
