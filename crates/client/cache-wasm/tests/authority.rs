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
async fn opfs_abi_missing_and_stale_tokens_keep_commands_without_restoring_retired_responses() {
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
    assert!(
        JsFuture::from(
            engine.check_authority(Some(allowed["generation"].as_str().unwrap().into()), true)
        )
        .await
        .is_err()
    );
    let query = "mutation Save($input: SaveEmailDraftInput!) { saveEmailDraft(input: $input) { thread { __typename id emailName: name } } }";
    let variables = json!({"input":{"bodyText":"authored reply","threadId":"local-thread"}});
    let data = json!({"saveEmailDraft":{"thread":{"__typename":"GraphqlSoupEmailThread","id":"server-thread","emailName":"retired subject"}}});
    for (index, admission) in [
        js(json!({"generation":allowed["generation"],"requireProof":true})),
        JsValue::UNDEFINED,
    ]
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
            admission.clone(),
        ))
        .await;
        assert_eq!(enqueued["initialClaim"]["kind"], "claimed");
        assert_eq!(
            enqueued["initialClaim"]["mutation"]["variables"]["input"]["bodyText"],
            "authored reply"
        );
        let queued = result(engine.inspect_mutations()).await;
        assert!(!queued.to_string().contains("retired subject"));
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
                admission,
            ),
        )
        .await;
    }
    assert_eq!(result(engine.inspect_mutations()).await, json!([]));
    assert!(
        JsFuture::from(
            engine.check_authority(Some(denied["generation"].as_str().unwrap().into()), true)
        )
        .await
        .is_ok()
    );
    JsFuture::from(engine.close()).await.unwrap();
    let reopened = open_cache(SCOPE.into(), None).await.unwrap();
    let current = result(reopened.current_authority(SCOPE.into())).await;
    assert_eq!(current["generation"], denied["generation"]);
    JsFuture::from(reopened.close()).await.unwrap();
    destroy_cache(SCOPE.into()).await.unwrap();
}
