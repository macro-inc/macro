use super::*;

const MAIL_QUERY: &str = r#"query MailProjection {
    user { id soup(input: {initial: {}}) { items {
        __typename id ... on GraphqlSoupEmailThread { isRead }
    } } }
}"#;
const MAIL_MUTATION: &str = r#"mutation MailSeen($input: MarkEmailThreadSeenInput!) {
    markEmailThreadSeen(input: $input) { __typename id isRead }
}"#;
const THREAD_ID: &str = "00000000-0000-0000-0000-000000000001";
/// Never stored, so a write naming it must read storage.
const COLD_THREAD_ID: &str = "00000000-0000-0000-0000-000000000002";

fn mutation_data(thread_id: &str) -> serde_json::Value {
    serde_json::json!({"markEmailThreadSeen": {
        "__typename": "GraphqlSoupEmailThread", "id": thread_id, "isRead": true
    }})
}

fn enqueue(engine: &CacheEngine, generation: Option<String>) -> js_sys::Promise {
    engine.enqueue_optimistic_mutation(
        None,
        "00000000-0000-4000-8000-000000000007".into(),
        MAIL_MUTATION.into(),
        None,
        js(serde_json::json!({"input":{"threadId":THREAD_ID}})),
        js(mutation_data(THREAD_ID)),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "mail-owner".into(),
        1.0,
        100.0,
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        generation,
        JsValue::UNDEFINED,
    )
}

enum WritePath {
    Query,
    Hydration,
    Enqueue,
    Commit,
}

#[wasm_bindgen_test(async)]
async fn mail_projection_reads_latch_reset_required_for_all_write_paths() {
    const SCOPE: &str = "cache-wasm-mail-projection-reset-latch";
    let engine = fresh_engine(SCOPE).await;
    for path in [
        WritePath::Query,
        WritePath::Hydration,
        WritePath::Enqueue,
        WritePath::Commit,
    ] {
        let data = serde_json::json!({"user":{"id":"mail-viewer","soup":{"items":[{
            "__typename":"GraphqlSoupEmailThread", "id":THREAD_ID, "isRead":false
        }]}}});
        // Warm the identity cache before arming GetBatch so the error comes
        // from Mail projection extraction, not identity loading.
        resolved(engine.write_query(
            write_context(None),
            MAIL_QUERY.into(),
            None,
            js(serde_json::json!({})),
            js(data.clone()),
            Some("mail-viewer".into()),
        ))
        .await;
        let generation = test_generation(&engine).await;
        let claim: Option<serde_json::Value> = if matches!(path, WritePath::Commit) {
            Some(from_js(
                resolved(enqueue(&engine, generation.clone())).await,
            ))
        } else {
            None
        };
        // The warm-up left THREAD_ID hot, so the write also names a cold thread
        // that the Mail projection must read from storage.
        let data = serde_json::json!({"user":{"id":"mail-viewer","soup":{"items":[
            {"__typename":"GraphqlSoupEmailThread", "id":THREAD_ID, "isRead":false},
            {"__typename":"GraphqlSoupEmailThread", "id":COLD_THREAD_ID, "isRead":false}
        ]}}});
        engine.arm_storage_fault(TestStorageFault::GetBatch).await;
        let promise = match path {
            WritePath::Query => engine.write_query(
                write_context(None),
                MAIL_QUERY.into(),
                None,
                js(serde_json::json!({})),
                js(data.clone()),
                Some("mail-viewer".into()),
            ),
            WritePath::Hydration => engine.hydrate_query(
                MAIL_QUERY.into(),
                None,
                js(serde_json::json!({})),
                js(data.clone()),
                Some("mail-viewer".into()),
                JsValue::UNDEFINED,
            ),
            WritePath::Enqueue => enqueue(&engine, generation.clone()),
            WritePath::Commit => {
                let claim = claim.unwrap();
                engine.commit_optimistic_write(
                    claim["transactionId"].as_str().unwrap().into(),
                    "mail-owner".into(),
                    claim["initialClaim"]["mutation"]["leaseGeneration"]
                        .as_str()
                        .unwrap()
                        .into(),
                    MAIL_MUTATION.into(),
                    None,
                    js(serde_json::json!({"input":{"threadId":THREAD_ID}})),
                    // The enqueue left THREAD_ID hot; a cold thread makes the
                    // Mail projection read storage.
                    js(mutation_data(COLD_THREAD_ID)),
                    generation,
                )
            }
        };
        assert_reset_required(promise).await;
        assert_reset_required(engine.bound_identity()).await;
        assert_reset_required(engine.clear()).await;
        resolved(engine.physical_reset()).await;
        let identity: Option<String> = from_js(resolved(engine.bound_identity()).await);
        assert_eq!(identity, None);
    }
    close_and_destroy(&engine, SCOPE).await;
}
