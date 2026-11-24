//! Channel responses, commits and reads the channel tests share.
use cache_core::channel_timeline::{
    ChannelCoverage, ChannelTimelineCommit, ChannelTimelineRequest, ChannelWatermark,
    MESSAGE_TYPENAME, TimelineSpan,
};
use cache_core::engine::{Engine, EngineError, NetworkWrite, WriteResult};
use cache_core::store::{InMemoryStorage, Storage};
use cache_core::value::{CacheValue, EntityKey};
use serde_json::{Value, json};
use std::convert::Infallible;

const FIELDS: &str = "__typename id channelId sortKey threadId deletedAt content";

pub type TestEngine = Engine<InMemoryStorage>;

pub fn key(id: &str) -> EntityKey<'static> {
    EntityKey::entity(MESSAGE_TYPENAME, &[id])
}

/// A root, or a reply when `thread` names its root.
pub fn message(channel: &str, id: &str, sort_key: &str, thread: Option<&str>) -> Value {
    json!({
        "__typename": MESSAGE_TYPENAME,
        "id": id,
        "channelId": channel,
        "sortKey": sort_key,
        "threadId": thread,
        "deletedAt": null,
        "content": id,
        "thread": null,
    })
}

/// `message` with other content.
pub fn saying(mut message: Value, content: &str) -> Value {
    message["content"] = json!(content);
    message
}

/// A root whose thread previews `replies`.
pub fn with_preview(mut root: Value, replies: &[Value]) -> Value {
    root["thread"] = json!({
        "__typename": "GraphqlChannelThread",
        "deletedAt": null,
        "replyCount": replies.len(),
        "preview": replies,
    });
    root
}

pub fn timeline_query() -> String {
    format!(
        "query Page($input: ChannelTimelineInput!) {{ user {{ __typename id channelTimeline(input: $input) {{ \
         __typename seq entries {{ __typename ... on GraphqlChannelMessage {{ {FIELDS} thread {{ __typename \
         deletedAt replyCount preview {{ {FIELDS} }} }} }} }} }} }} }}"
    )
}

/// Writes a timeline page of `channel` read at `seq`, with its commit.
pub async fn write_page(
    engine: &mut TestEngine,
    channel: &str,
    seq: &str,
    entries: &[Value],
    commit: Option<&ChannelTimelineCommit>,
) -> Result<WriteResult, EngineError<Infallible>> {
    let variables = json!({"input": {"channelId": channel}});
    let data = json!({"user": {"__typename": "GraphqlUser", "id": "u1", "channelTimeline": {
        "__typename": "GraphqlChannelTimelinePage", "seq": seq, "entries": entries,
    }}});
    let input = NetworkWrite {
        query: &timeline_query(),
        operation_name: None,
        variables: variables.as_object().unwrap(),
        data: &data,
        identity: None,
        channel: commit,
    };
    engine
        .write_query_with_registration(None, None, input)
        .await
}

/// Content the server sent without a sequence.
pub async fn write_undated(engine: &mut TestEngine, entry: &Value) -> WriteResult {
    let query = format!(
        "query One($c: ID!, $m: ID!) {{ user {{ __typename id channelMessage(channelId: $c, messageId: $m) {{ {FIELDS} }} }} }}"
    );
    let variables = json!({"c": entry["channelId"], "m": entry["id"]});
    let data = json!({"user": {"__typename": "GraphqlUser", "id": "u1", "channelMessage": entry}});
    let input = NetworkWrite {
        query: &query,
        operation_name: None,
        variables: variables.as_object().unwrap(),
        data: &data,
        identity: None,
        channel: None,
    };
    engine
        .write_query_with_registration(None, None, input)
        .await
        .unwrap()
}

pub fn latest(channel: &str, limit: u16) -> ChannelTimelineRequest {
    ChannelTimelineRequest {
        channel_id: channel.into(),
        thread_root_id: None,
        limit,
        before: None,
        after: None,
        around: None,
    }
}

pub fn replies(channel: &str, root: &str) -> ChannelTimelineRequest {
    ChannelTimelineRequest {
        thread_root_id: Some(root.into()),
        ..latest(channel, 100)
    }
}

pub fn coverage(thread: Option<&str>, start: &str, end: &str) -> ChannelCoverage {
    ChannelCoverage {
        thread_root_id: thread.map(Into::into),
        span: TimelineSpan {
            start: start.into(),
            end: end.into(),
        },
    }
}

pub fn commit(channel: &str) -> ChannelTimelineCommit {
    ChannelTimelineCommit {
        channel_id: channel.into(),
        ..ChannelTimelineCommit::default()
    }
}

/// The commit of a page read at `seq` that lists `coverage` in full.
pub fn page(channel: &str, seq: &str, coverage: Vec<ChannelCoverage>) -> ChannelTimelineCommit {
    ChannelTimelineCommit {
        seq: Some(seq.into()),
        watermark: Some(ChannelWatermark::Lower),
        coverage,
        ..commit(channel)
    }
}

/// The commit of the changes after `from` up to `to`.
pub fn changes(channel: &str, from: &str, to: &str) -> ChannelTimelineCommit {
    ChannelTimelineCommit {
        seq: Some(to.into()),
        watermark: Some(ChannelWatermark::Advance { from: from.into() }),
        ..commit(channel)
    }
}

pub fn removing(mut commit: ChannelTimelineCommit, ids: &[&str]) -> ChannelTimelineCommit {
    commit.removed_ids = ids.iter().map(|id| (*id).to_owned()).collect();
    commit
}

pub fn ids<'a>(keys: &'a [EntityKey<'static>]) -> Vec<&'a str> {
    keys.iter().filter_map(EntityKey::id).collect()
}

/// The ids a covered page lists; `None` when the page is not covered.
pub async fn listed(
    engine: &mut TestEngine,
    request: &ChannelTimelineRequest,
) -> Option<Vec<String>> {
    let page = engine.channel_timeline(request).await.unwrap().value;
    page.covered
        .then(|| ids(&page.keys).into_iter().map(str::to_owned).collect())
}

/// The content held of a message; `None` when none is, or only its removal.
pub async fn content(engine: &mut TestEngine, id: &str) -> Option<String> {
    let records = engine.storage().get_batch(&[key(id)]).await.unwrap();
    match records.into_iter().next()??.fields.remove("content")? {
        CacheValue::String(content) => Some(content),
        _ => None,
    }
}
