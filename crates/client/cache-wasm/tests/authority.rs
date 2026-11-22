#![cfg(target_arch = "wasm32")]
use cache_wasm::{CacheEngine, destroy_cache, open_cache};
use serde_json::{Value, json};
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::*;
wasm_bindgen_test_configure!(run_in_dedicated_worker);

fn js(value: Value) -> JsValue {
    use serde::Serialize;
    value
        .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
        .unwrap()
}
async fn result(promise: js_sys::Promise) -> Value {
    serde_wasm_bindgen::from_value(JsFuture::from(promise).await.unwrap()).unwrap()
}
async fn transition(engine: &CacheEngine, scope: &str, policy: &str) -> Value {
    let before = result(engine.current_authority(scope.into())).await;
    result(engine.transition_authority(
        scope.into(),
        before["generation"].as_str().unwrap().into(),
        policy.into(),
    ))
    .await["authority"]
        .clone()
}

#[wasm_bindgen_test(async)]
async fn opfs_stale_generation_settles_commands_without_restoring_retired_responses() {
    const SCOPE: &str = "cache-wasm-member-access-abi";
    destroy_cache(SCOPE.into()).await.unwrap();
    let engine = open_cache(SCOPE.into(), None).await.unwrap();
    result(engine.write_query(
        js(json!({})),
        "{ user { id } }".into(),
        None,
        js(json!({})),
        js(json!({"user":{"id":"viewer"}})),
        Some("viewer".into()),
    ))
    .await;
    let allowed = transition(&engine, SCOPE, "team:allowed").await;
    let denied = transition(&engine, SCOPE, "team:denied").await;
    let query = "mutation Save($input: SaveEmailDraftInput!) { saveEmailDraft(input: $input) { thread { __typename id emailName: name } } }";
    let variables = json!({"input":{"bodyText":"authored reply","threadId":"local-thread"}});
    let data = json!({"saveEmailDraft":{"thread":{"__typename":"GraphqlSoupEmailThread","id":"server-thread","emailName":"retired subject"}}});
    for (index, generation) in [Some(allowed["generation"].as_str().unwrap().to_owned())]
        .into_iter()
        .enumerate()
    {
        let enqueued = result(engine.enqueue_optimistic_mutation(
            None,
            uuid::Uuid::new_v4().to_string(),
            query.into(),
            Some("Save".into()),
            js(variables.clone()),
            js(data.clone()),
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            1.0,
            format!("writer-{index}"),
            2.0,
            100.0,
            JsValue::UNDEFINED,
            JsValue::UNDEFINED,
            generation.clone(),
            JsValue::UNDEFINED,
        ))
        .await;
        assert_eq!(enqueued["initialClaim"]["kind"], "claimed");
        assert_eq!(
            enqueued["initialClaim"]["mutation"]["variables"]["input"]["bodyText"],
            "authored reply"
        );
        let queued = result(engine.inspect_mutations()).await;
        assert!(!queued.to_string().contains("retired subject"));
        let records = result(engine.read_records_by_keys(
            "fragment Thread on GraphqlSoupEmailThread { id name }".into(),
            "Thread".into(),
            js(json!(["GraphqlSoupEmailThread:server-thread"])),
        ))
        .await;
        assert!(!records.to_string().contains("retired subject"));
        result(
            engine.commit_optimistic_write(
                enqueued["transactionId"].as_str().unwrap().into(),
                format!("writer-{index}"),
                enqueued["initialClaim"]["mutation"]["leaseGeneration"]
                    .as_str()
                    .unwrap()
                    .into(),
                query.into(),
                Some("Save".into()),
                js(variables.clone()),
                js(data.clone()),
                generation,
            ),
        )
        .await;
        let records = result(engine.read_records_by_keys(
            "fragment Thread on GraphqlSoupEmailThread { id name }".into(),
            "Thread".into(),
            js(json!(["GraphqlSoupEmailThread:server-thread"])),
        ))
        .await;
        assert!(!records.to_string().contains("retired subject"));
    }
    assert_eq!(result(engine.inspect_mutations()).await, json!([]));
    JsFuture::from(engine.close()).await.unwrap();
    let reopened = open_cache(SCOPE.into(), None).await.unwrap();
    let current = result(reopened.current_authority(SCOPE.into())).await;
    assert_eq!(current["generation"], denied["generation"]);
    let records = result(reopened.read_records_by_keys(
        "fragment Thread on GraphqlSoupEmailThread { id name }".into(),
        "Thread".into(),
        js(json!(["GraphqlSoupEmailThread:server-thread"])),
    ))
    .await;
    assert!(!records.to_string().contains("retired subject"));
    JsFuture::from(reopened.close()).await.unwrap();
    destroy_cache(SCOPE.into()).await.unwrap();
}

#[wasm_bindgen_test(async)]
async fn first_non_denied_proof_preserves_offline_mail() {
    const SCOPE: &str = "cache-wasm-first-proof";
    for policy in ["team:allowed", "none"] {
        destroy_cache(SCOPE.into()).await.unwrap();
        let engine = open_cache(SCOPE.into(), None).await.unwrap();
        let initial = result(engine.current_authority(SCOPE.into())).await;
        let query = "{ user { id emailThread(id: \"thread\") { __typename id name } } }";
        let data = json!({"user":{"id":"viewer","emailThread":{"__typename":"GraphqlSoupEmailThread","id":"thread","name":"offline subject"}}});
        result(engine.write_query(
            js(json!({})),
            query.into(),
            None,
            js(json!({})),
            js(data.clone()),
            Some("viewer".into()),
        ))
        .await;
        let before = result(engine.current_authority(SCOPE.into())).await;
        assert_eq!(before["generation"], initial["generation"]);
        let allowed = transition(&engine, SCOPE, policy).await;
        assert_eq!(allowed["generation"], before["generation"]);
        let cached =
            result(engine.read_query(None, query.into(), None, js(json!({})), js(json!([])))).await;
        assert_eq!(cached["kind"], "hit");
        assert_eq!(cached["data"], data);
        result(engine.close()).await;
        let reopened = open_cache(SCOPE.into(), None).await.unwrap();
        let restored = result(reopened.current_authority(SCOPE.into())).await;
        assert_eq!(restored["generation"], initial["generation"]);
        assert_eq!(restored["account"], "viewer");
        result(reopened.close()).await;
    }
    destroy_cache(SCOPE.into()).await.unwrap();
}
