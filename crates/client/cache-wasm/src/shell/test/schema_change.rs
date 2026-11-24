//! Opening a browser cache brings its records to the worker's schema.

use super::*;

const LABEL_QUERY: &str = "query Label { user { id runtimeLabel } }";

/// The bundled schema with a `runtimeLabel` of `declared` on users.
fn labelled(declared: &str) -> std::sync::Arc<cache_core::meta::Schema> {
    cache_core::meta::Schema::from_sdl(&format!(
        "{}\nextend type GraphqlUser {{ runtimeLabel: {declared} }}",
        cache_core::meta::BUNDLED_SCHEMA_SDL
    ))
    .unwrap()
}

/// Sets the worker's schema; `None` puts back the bundled one the other
/// tests open with.
fn set_worker_schema(schema: Option<std::sync::Arc<cache_core::meta::Schema>>) {
    RUNTIME_SCHEMA.with(|slot| *slot.borrow_mut() = schema);
}

async fn open(scope: &str) -> (CacheEngine, CacheOpenOutcome, JsSchemaChange) {
    open_cache_inner(scope.into(), None, false, None, false)
        .await
        .expect("open cache")
}

async fn write_label(engine: &CacheEngine) {
    resolved(engine.write_query(
        write_context(None),
        LABEL_QUERY.into(),
        Some("Label".into()),
        js(serde_json::json!({})),
        js(serde_json::json!({"user": {"id": "viewer", "runtimeLabel": "label"}})),
        None,
    ))
    .await;
}

async fn read_label(engine: &CacheEngine) -> String {
    let read: serde_json::Value = from_js(
        resolved(engine.read_query(
            None,
            LABEL_QUERY.into(),
            Some("Label".into()),
            js(serde_json::json!({})),
            JsValue::UNDEFINED,
        ))
        .await,
    );
    read["kind"].as_str().unwrap().to_owned()
}

#[wasm_bindgen_test(async)]
async fn a_reopen_sorts_nothing_and_a_retyped_field_drops_only_its_type() {
    const SCOPE: &str = "cache-wasm-schema-change";
    destroy_cache(SCOPE.into())
        .await
        .expect("wipe test database");
    set_worker_schema(Some(labelled("String")));
    let (engine, _, change) = open(SCOPE).await;
    assert_eq!(change.change, "unchanged");
    write_label(&engine).await;
    resolved(engine.close()).await;

    let (engine, outcome, change) = open(SCOPE).await;
    assert_eq!(outcome.as_str(), "opened-existing");
    assert_eq!(change.change, "unchanged");
    assert_eq!(read_label(&engine).await, "hit");
    resolved(engine.close()).await;

    set_worker_schema(Some(labelled("[String]")));
    let (engine, outcome, change) = open(SCOPE).await;
    assert_eq!(outcome.as_str(), "opened-existing");
    assert_eq!(change.change, "types");
    assert!(change.changed_types > 0);
    assert!(change.dropped_records > 0);
    assert_eq!(read_label(&engine).await, "miss");
    set_worker_schema(None);
    close_and_destroy(&engine, SCOPE).await;
}

#[wasm_bindgen_test(async)]
async fn a_physical_reset_stores_the_schema_so_the_next_open_sorts_nothing() {
    // Records a reset cache takes in are written under the worker's schema;
    // without it stored, the next open would sort them against a guess.
    const SCOPE: &str = "cache-wasm-schema-after-reset";
    destroy_cache(SCOPE.into())
        .await
        .expect("wipe test database");
    set_worker_schema(Some(labelled("String")));
    let (engine, _, _) = open(SCOPE).await;
    resolved(engine.physical_reset()).await;
    write_label(&engine).await;
    resolved(engine.close()).await;

    let (engine, outcome, change) = open(SCOPE).await;
    assert_eq!(outcome.as_str(), "opened-existing");
    assert_eq!(change.change, "unchanged");
    assert_eq!(read_label(&engine).await, "hit");
    set_worker_schema(None);
    close_and_destroy(&engine, SCOPE).await;
}
