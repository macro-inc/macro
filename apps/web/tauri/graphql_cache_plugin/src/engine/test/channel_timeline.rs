use super::*;
use cache_core::channel_timeline::{
    ChannelEviction, ChannelTimelineCommit, ChannelTimelineRequest,
};

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
        "seq": { "kind": "lower", "seq": "3" },
        "touchedAtMs": 10,
    }))
    .unwrap();
    let committed =
        serde_json::to_value(block_on(handle.channel_timeline_commit(commit)).unwrap()).unwrap();
    assert_eq!(committed["channelSeq"], "3");
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
fn invalid_channel_commits_are_rejected() {
    let handle = spawn_handle();
    let commit: ChannelTimelineCommit = serde_json::from_value(serde_json::json!({
        "channelId": "c1",
        "seq": { "kind": "advance", "from": "5", "to": "4" },
    }))
    .unwrap();
    assert!(block_on(handle.channel_timeline_commit(commit)).is_err());
}
