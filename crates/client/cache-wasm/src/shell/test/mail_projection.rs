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

fn mutation_data() -> serde_json::Value {
    serde_json::json!({"markEmailThreadSeen": {
        "__typename": "GraphqlSoupEmailThread", "id": THREAD_ID, "isRead": true
    }})
}

fn enqueue(engine: &CacheEngine) -> js_sys::Promise {
    engine.enqueue_optimistic_mutation(
        None,
        "00000000-0000-4000-8000-000000000007".into(),
        MAIL_MUTATION.into(),
        None,
        js(serde_json::json!({"input":{"threadId":THREAD_ID}})),
        js(mutation_data()),
        JsValue::UNDEFINED,
        JsValue::UNDEFINED,
        1.0,
        "mail-owner".into(),
        1.0,
        100.0,
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
        let claim: Option<serde_json::Value> = if matches!(path, WritePath::Commit) {
            Some(from_js(resolved(enqueue(&engine)).await))
        } else {
            None
        };
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
            ),
            WritePath::Enqueue => enqueue(&engine),
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
                    js(mutation_data()),
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
