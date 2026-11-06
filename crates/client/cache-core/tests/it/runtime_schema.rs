use cache_core::engine::{BeginOptimisticWrite, Engine, ReadResult};
use cache_core::meta::{BUNDLED_SCHEMA_SDL, Schema, bundled_schema};
use cache_core::record_selection::RecordSelection;
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use serde_json::json;

fn new_schema() -> std::sync::Arc<Schema> {
    let sdl = format!(
        "{BUNDLED_SCHEMA_SDL}\nextend type GraphqlUser {{ runtimeLabel: String }}\nextend type {} {{ setRuntimeLabel: GraphqlUser! }}",
        bundled_schema().mutation_root().unwrap()
    );
    Schema::from_sdl(&sdl).unwrap()
}

#[test]
fn installed_binary_accepts_new_fields_and_replays_them_after_bundle_rollback() {
    pollster::block_on(async {
        let old = bundled_schema();
        let new = new_schema();
        let variables = serde_json::Map::new();
        let query = "query { user { id runtimeLabel } }";
        let mutation = "mutation { setRuntimeLabel { id runtimeLabel } }";
        let data = json!({"user": {"id": "viewer", "runtimeLabel": "server"}});
        let mut engine = Engine::with_schema(InMemoryStorage::new(), 10, old.clone());
        assert!(
            engine
                .write_query(None, query, None, &variables, &data, None)
                .await
                .is_err()
        );
        let generation = engine.current_storage_generation().await.unwrap();
        engine.install_schema(&new).unwrap();
        engine
            .write_query(None, query, None, &variables, &data, None)
            .await
            .unwrap();
        assert!(
            matches!(engine.read_query(None, query, None, &variables).await.unwrap(), ReadResult::Hit { data: actual } if actual == data)
        );
        let fragment = RecordSelection::parse(
            engine.schema(),
            "fragment F on GraphqlUser { id runtimeLabel }",
            "F",
        )
        .unwrap();
        assert_eq!(
            engine
                .read_records_by_keys(&fragment, &[EntityKey::entity("GraphqlUser", &["viewer"])])
                .await
                .unwrap()
                .len(),
            1
        );
        let optimistic = json!({"setRuntimeLabel": {"id": "viewer", "runtimeLabel": "pending"}});
        engine
            .begin_optimistic_write(
                None,
                BeginOptimisticWrite {
                    client_metadata: None,
                    identity_bindings: &[],
                    uuid: "01900000-0000-7000-8000-000000000001",
                    query: mutation,
                    operation_name: None,
                    variables: &variables,
                    data: &optimistic,
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 1,
                },
            )
            .await
            .unwrap();
        let saved_schema = serde_json::to_string(engine.schema().artifact()).unwrap();
        let storage = engine.into_storage();
        // Persisted metadata retains definitions needed by newer queued work even
        // when the next bundle is older. No global metadata or leaked strings.
        let schema = Schema::from_json(&saved_schema)
            .unwrap()
            .merge(&old)
            .unwrap();
        let mut reopened = Engine::with_schema(storage, 10, schema);
        assert_eq!(
            reopened.current_storage_generation().await.unwrap(),
            generation
        );
        let read = reopened
            .read_query(None, query, None, &variables)
            .await
            .unwrap();
        assert!(
            matches!(read, ReadResult::Hit { data } if data["user"]["runtimeLabel"] == "pending")
        );
        assert!(
            reopened
                .schema()
                .field_meta("GraphqlUser", "runtimeLabel")
                .is_some()
        );
        // A separate old engine must not accidentally use the new schema.
        let mut isolated = Engine::with_schema(InMemoryStorage::new(), 10, old);
        assert!(
            isolated
                .write_query(None, query, None, &variables, &data, None)
                .await
                .is_err()
        );
    });
}
