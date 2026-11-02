use super::*;

#[wasm_bindgen_test(async)]
async fn scoped_hydration_rejects_a_late_browser_response() {
    let engine = fresh_engine("scoped-hydration").await;
    let generation = resolved(engine.current_storage_generation())
        .await
        .as_string()
        .unwrap();
    let scope = serde_json::json!({"storageGeneration": generation, "identity": "viewer"});
    let hydrate = || {
        engine.hydrate_query(
            "{ user { id } }".into(),
            None,
            js(serde_json::json!({})),
            js(serde_json::json!({"user":{"id":"viewer"}})),
            Some("viewer".into()),
            js(scope.clone()),
        )
    };
    resolved(hydrate()).await;
    resolved(engine.clear()).await;
    let error = JsFuture::from(hydrate()).await.unwrap_err();
    let message = js_sys::Reflect::get(&error, &"message".into())
        .unwrap()
        .as_string()
        .unwrap();
    assert_eq!(message, "cache hydration scope changed");
    assert_ne!(
        resolved(engine.current_storage_generation())
            .await
            .as_string()
            .unwrap(),
        generation
    );
}
