use super::*;
use cache_core::channel_timeline::{
    ChannelEviction, ChannelTimelineCommit, ChannelTimelineRequest,
};
use cache_core::engine::channel_changes::ChannelChange;

fn latest() -> ChannelTimelineRequest {
    serde_json::from_value(serde_json::json!({ "channelId": "c1", "limit": 50 })).unwrap()
}

fn page(handle: &EngineHandle) -> serde_json::Value {
    serde_json::to_value(block_on(handle.channel_timeline(latest())).unwrap()).unwrap()
}

#[test]
fn channel_pages_commits_and_eviction_cross_the_ipc_boundary() {
    let handle = spawn_handle();
    let miss = page(&handle);
    assert_eq!(miss["kind"], "page");
    assert_eq!(miss["covered"], false);
    assert_eq!(miss["seq"], serde_json::Value::Null);

    let commit: ChannelTimelineCommit = serde_json::from_value(serde_json::json!({
        "channelId": "c1",
        "coverage": [{ "start": "", "end": "\u{10FFFF}" }],
        "seq": "3",
        "watermark": { "kind": "lower" },
        "touchedAtMs": 10,
    }))
    .unwrap();
    let committed =
        serde_json::to_value(block_on(handle.channel_timeline_commit(commit)).unwrap()).unwrap();
    assert_eq!(
        committed["channel"],
        serde_json::json!({ "channelId": "c1", "seq": "3", "outcome": "applied" })
    );
    assert_eq!(committed["revisionAdvanced"], true);
    assert_eq!(committed["changed"], serde_json::json!([]));

    let covered = page(&handle);
    assert_eq!(covered["covered"], true);
    assert_eq!(covered["keys"], serde_json::json!([]));
    assert_eq!(covered["olderCursor"], serde_json::Value::Null);
    assert_eq!(covered["seq"], "3");

    let stats = serde_json::to_value(block_on(handle.channel_timeline_stats()).unwrap()).unwrap();
    assert_eq!(stats, serde_json::json!({ "channels": 1, "entries": 0 }));

    let eviction: ChannelEviction =
        serde_json::from_value(serde_json::json!({ "touchedBeforeMs": 11, "maxChannels": 5 }))
            .unwrap();
    let evicted =
        serde_json::to_value(block_on(handle.channel_timeline_evict(eviction)).unwrap()).unwrap();
    assert_eq!(evicted["channelIds"], serde_json::json!(["c1"]));
    assert_eq!(evicted["hasMore"], false);
    assert_eq!(page(&handle)["covered"], false);
}

#[test]
fn a_response_and_its_channel_commit_are_stored_together() {
    const PAGE: &str = "query Page($input: ChannelTimelineInput!) { user { __typename id channelTimeline(input: $input) { __typename seq entries { __typename ... on GraphqlChannelMessage { __typename id channelId sortKey threadId deletedAt content } } } } }";
    let page_input =
        || Variables::from_iter([("input".into(), serde_json::json!({ "channelId": "c1" }))]);
    let response = |seq: &str, id: &str| {
        serde_json::json!({"user": {"__typename": "GraphqlUser", "id": "u1", "channelTimeline": {
            "__typename": "GraphqlChannelTimelinePage",
            "seq": seq,
            "entries": [{
                "__typename": "GraphqlChannelMessage",
                "id": id,
                "channelId": "c1",
                "sortKey": format!("10{id}"),
                "threadId": null,
                "deletedAt": null,
                "content": id,
            }],
        }}})
    };
    let commit = |value| Some(serde_json::from_value(value).unwrap());
    let handle = spawn_handle();
    let written = block_on(handle.write(WriteRequest {
        origin_op_id: None,
        registration: None,
        query: PAGE.into(),
        operation_name: None,
        variables: page_input(),
        data: response("5", "1"),
        identity: None,
        channel_commit: commit(serde_json::json!({
            "channelId": "c1",
            "seq": "5",
            "watermark": { "kind": "lower" },
            "coverage": [{ "start": "", "end": "\u{10FFFF}" }],
        })),
    }))
    .unwrap();
    assert_eq!(
        serde_json::to_value(written).unwrap()["channel"],
        serde_json::json!({ "channelId": "c1", "seq": "5", "outcome": "applied" })
    );
    let hydrated = block_on(handle.hydrate_query(
        PAGE.into(),
        None,
        page_input(),
        response("6", "2"),
        None,
        None,
        commit(serde_json::json!({
            "channelId": "c1",
            "seq": "6",
            "watermark": { "kind": "advance", "from": "5" },
            "removedIds": ["1"],
        })),
    ))
    .unwrap();
    assert_eq!(
        serde_json::to_value(hydrated.write_result).unwrap()["channel"],
        serde_json::json!({ "channelId": "c1", "seq": "6", "outcome": "applied" })
    );
    let held = page(&handle);
    assert_eq!(held["covered"], true);
    assert_eq!(held["seq"], "6");
    assert_eq!(held["keys"].as_array().unwrap().len(), 1, "{held}");
}

#[test]
fn invalid_channel_commits_are_rejected() {
    let handle = spawn_handle();
    let commit: ChannelTimelineCommit = serde_json::from_value(serde_json::json!({
        "channelId": "c1",
        "seq": "4",
        "watermark": { "kind": "advance", "from": "5" },
    }))
    .unwrap();
    assert!(block_on(handle.channel_timeline_commit(commit)).is_err());
}

#[test]
fn eviction_is_not_fenced_by_the_generation_it_was_asked_under() {
    block_on(async {
        let handle = spawn_handle();
        let first = handle.current_authority("profile").await.unwrap();
        let held = handle
            .transition_authority("profile", first.generation, "team:held".into())
            .await
            .unwrap()
            .authority;
        let commit: ChannelTimelineCommit = serde_json::from_value(serde_json::json!({
            "channelId": "c1",
            "touchedAtMs": 10,
        }))
        .unwrap();
        handle.channel_timeline_commit(commit).await.unwrap();
        handle
            .transition_authority("profile", held.generation, "team:other".into())
            .await
            .unwrap();
        // It only removes, so what is left after a session change is as stale
        // as it was before: both hosts remove it.
        let evicted = handle
            .with_generation(Some(held.generation))
            .channel_timeline_evict(ChannelEviction {
                touched_before_ms: 11,
                max_channels: 5,
            })
            .await
            .unwrap();
        assert_eq!(evicted.channel_ids, ["c1"]);
    });
}

#[test]
fn a_transaction_tells_the_listener_of_its_channels_before_it_answers() {
    let heard = Arc::new(std::sync::Mutex::new(Vec::new()));
    let listener = heard.clone();
    let handle = EngineHandle::with_channel_listener(
        TursoStorage::open_in_memory("scope-1").unwrap(),
        None,
        cache_core::meta::bundled_schema(),
        move |changes: &[ChannelChange]| {
            listener
                .lock()
                .unwrap()
                .push(serde_json::to_value(changes).unwrap());
        },
    );
    let commit = |value| serde_json::from_value::<ChannelTimelineCommit>(value).unwrap();
    for (value, kind) in [
        (
            serde_json::json!({ "channelId": "c1", "seq": "3", "watermark": { "kind": "lower" } }),
            Some("changed"),
        ),
        (
            serde_json::json!({ "channelId": "c1", "touchedAtMs": 10 }),
            None,
        ),
        (
            serde_json::json!({ "channelId": "c1", "seq": "4", "reset": true }),
            Some("reset"),
        ),
    ] {
        block_on(handle.channel_timeline_commit(commit(value))).unwrap();
        let reported: Vec<_> = std::mem::take(&mut *heard.lock().unwrap());
        let expected: Vec<_> = kind
            .map(|kind| serde_json::json!([{ "channelId": "c1", "kind": kind }]))
            .into_iter()
            .collect();
        assert_eq!(reported, expected);
    }
}
