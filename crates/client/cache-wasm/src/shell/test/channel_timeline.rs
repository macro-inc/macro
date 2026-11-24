use super::*;
use cache_core::channel_timeline::{TIMELINE_HEAD, TIMELINE_START};
use serde_json::{Value, json};
use wasm_bindgen::JsCast;

const PAGE: &str = "query Page($input: ChannelTimelineInput!) { user { __typename id channelTimeline(input: $input) { __typename seq entries { __typename ... on GraphqlChannelMessage { __typename id channelId sortKey threadId deletedAt content } } } } }";

fn page(seq: &str, ids: &[&str]) -> JsValue {
    let entries: Vec<_> = ids
        .iter()
        .map(|id| {
            json!({
                "__typename": "GraphqlChannelMessage",
                "id": id,
                "channelId": "c1",
                "sortKey": format!("10{id}"),
                "threadId": null,
                "deletedAt": null,
                "content": id,
            })
        })
        .collect();
    js(
        json!({"user": {"__typename": "GraphqlUser", "id": "u1", "channelTimeline": {
            "__typename": "GraphqlChannelTimelinePage", "seq": seq, "entries": entries,
        }}}),
    )
}

fn variables() -> JsValue {
    js(json!({"input": {"channelId": "c1"}}))
}

/// Every report of `engine`, in the order it made them.
async fn heard(engine: &CacheEngine) -> (js_sys::Array, Closure<dyn Fn(JsValue)>) {
    let reports = js_sys::Array::new();
    let received = reports.clone();
    let listener = Closure::<dyn Fn(JsValue)>::new(move |changes| {
        received.push(&changes);
    });
    let callback = listener.as_ref().unchecked_ref::<js_sys::Function>();
    resolved(engine.on_channels_changed(callback.clone())).await;
    (reports, listener)
}

async fn listed(engine: &CacheEngine) -> Value {
    let result: Value = from_js(
        resolved(engine.channel_timeline(js(json!({"channelId": "c1", "limit": 10})))).await,
    );
    result["keys"].clone()
}

#[wasm_bindgen_test(async)]
async fn a_response_and_its_channel_commit_cross_the_js_boundary_together() {
    let engine = fresh_engine("cache-wasm-channel-commit").await;
    let written: Value = from_js(
        resolved(engine.write_query(
            js(json!({"channelCommit": {
                "channelId": "c1",
                "seq": "5",
                "watermark": {"kind": "lower"},
                "coverage": [{"start": TIMELINE_START, "end": TIMELINE_HEAD}],
            }})),
            PAGE.into(),
            None,
            variables(),
            page("5", &["1", "2"]),
            None,
        ))
        .await,
    );
    assert_eq!(
        written["channel"],
        json!({"channelId": "c1", "seq": "5", "outcome": "applied"})
    );
    assert_eq!(listed(&engine).await.as_array().unwrap().len(), 2);

    let changes = |from: &str, seq: &str, removed: &[&str]| {
        js(json!({
            "channelId": "c1",
            "seq": seq,
            "watermark": {"kind": "advance", "from": from},
            "removedIds": removed,
        }))
    };
    let hydrated: Value = from_js(
        resolved(engine.hydrate_query(
            PAGE.into(),
            None,
            variables(),
            page("6", &["3"]),
            None,
            JsValue::UNDEFINED,
            changes("5", "6", &["1"]),
        ))
        .await,
    );
    assert_eq!(
        hydrated["channel"],
        json!({"channelId": "c1", "seq": "6", "outcome": "applied"})
    );

    // The staged path carries it too, and reports a gap.
    resolved(engine.prepare_hydrate(
        PAGE.into(),
        None,
        variables(),
        page("9", &["4"]),
        None,
        JsValue::UNDEFINED,
        changes("8", "9", &[]),
    ))
    .await;
    resolved(engine.stage_hydrate()).await;
    let hydrated: Value = from_js(resolved(engine.commit_hydrate()).await);
    assert_eq!(
        hydrated["channel"],
        json!({"channelId": "c1", "seq": "6", "outcome": "gap"})
    );
    let ids: Vec<_> = listed(&engine).await.as_array().unwrap().clone();
    assert_eq!(ids.len(), 3, "{ids:?}");
    assert!(!ids.iter().any(|key| key.as_str().unwrap().ends_with(":1")));

    let touched: Value = from_js(
        resolved(engine.channel_timeline_commit(js(json!({
            "channelId": "c1",
            "touchedAtMs": 7,
        }))))
        .await,
    );
    assert_eq!(
        touched["channel"],
        json!({"channelId": "c1", "seq": "6", "outcome": "applied"})
    );
    JsFuture::from(engine.channel_timeline_commit(js(json!({"channelId": "c1", "reset": true}))))
        .await
        .expect_err("a reset needs the sequence it was read at");
    close_and_destroy(&engine, "cache-wasm-channel-commit").await;
}

#[wasm_bindgen_test(async)]
async fn changed_channels_are_reported_before_a_call_resolves_and_after_a_reset() {
    let scope = "cache-wasm-channel-reports";
    let engine = fresh_engine(scope).await;
    let (reports, _listener) = heard(&engine).await;
    let write = |seq: &str, id: &str| {
        engine.write_query(
            js(json!({})),
            PAGE.into(),
            None,
            variables(),
            page(seq, &[id]),
            None,
        )
    };
    resolved(write("5", "1")).await;
    resolved(write("5", "1")).await;
    resolved(engine.physical_reset()).await;
    resolved(write("6", "1")).await;
    let changed = json!([{"channelId": "c1", "kind": "changed"}]);
    assert_eq!(
        from_js::<Value>(reports.into()),
        json!([changed, changed]),
        "the same page again reports nothing, and a reset keeps the listener"
    );
    close_and_destroy(&engine, scope).await;
}
