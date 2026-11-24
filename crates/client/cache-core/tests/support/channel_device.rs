//! What a host does with a channel's answers: each is one write, with the
//! commit its request asked for.

use crate::channel_server::{Anchor, Answer, Entry, List};
use cache_core::channel_timeline::{
    ChannelCoverage, ChannelEviction, ChannelTimelineCommit, ChannelTimelineRequest,
    ChannelTimelineStorage, ChannelWatermark, MESSAGE_TYPENAME, TimelineSpan,
};
use cache_core::engine::{
    BeginOptimisticWrite, Engine, InitialClaimOutcome, NetworkWrite, ReadResult,
};
use cache_core::identity::IdentityBinding;
use cache_core::meta::{BUNDLED_SCHEMA_SDL, Schema, bundled_schema};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::value::{CacheValue, EntityKey};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, LazyLock};

const FIELDS: &str = "__typename id channelId sortKey threadId deletedAt content";
const SEND: &str = "mutation { sendMessage { __typename seq message { __typename id channelId \
     sortKey threadId deletedAt content } } }";

static SCHEMA: LazyLock<Arc<Schema>> = LazyLock::new(|| {
    let sdl = format!(
        "{BUNDLED_SCHEMA_SDL}\nextend type {} {{ sendMessage: MessageWrite! }}\n\
         type MessageWrite {{ message: GraphqlChannelMessage! seq: String! }}",
        bundled_schema().mutation_root().unwrap()
    );
    Schema::from_sdl(&sdl).unwrap()
});

static PAGE: LazyLock<String> = LazyLock::new(|| {
    format!(
        "query Page($input: ChannelTimelineInput!) {{ user {{ __typename id channelTimeline(input: $input) {{ \
         __typename seq entries {{ __typename ... on GraphqlChannelMessage {{ {FIELDS} thread {{ __typename \
         deletedAt replyCount preview {{ {FIELDS} }} }} }} }} }} }} }}"
    )
});

static ONE: LazyLock<String> = LazyLock::new(|| {
    format!(
        "query One($c: ID!, $m: ID!) {{ user {{ __typename id channelMessage(channelId: $c, messageId: $m) {{ {FIELDS} }} }} }}"
    )
});

fn key(id: &str) -> EntityKey<'static> {
    EntityKey::entity(MESSAGE_TYPENAME, &[id])
}

fn flat(entry: &Entry) -> Value {
    json!({
        "__typename": MESSAGE_TYPENAME,
        "id": entry.message.id,
        "channelId": entry.message.channel,
        "sortKey": entry.message.sort_key,
        "threadId": entry.message.thread,
        "deletedAt": null,
        "content": entry.version.to_string(),
    })
}

fn message(entry: &Entry) -> Value {
    let mut value = flat(entry);
    value["thread"] = match entry.preview.as_slice() {
        [] => Value::Null,
        preview => json!({
            "__typename": "GraphqlChannelThread",
            "deletedAt": null,
            "replyCount": preview.len(),
            "preview": preview.iter().map(flat).collect::<Vec<_>>(),
        }),
    };
    value
}

/// Which page an answer is stored as: one link for each list.
fn page_variables(list: &List) -> Map<String, Value> {
    let input = match &list.thread {
        None => json!({"channelId": list.channel}),
        Some(root) => json!({"channelId": list.channel, "before": root}),
    };
    Map::from_iter([("input".to_owned(), input)])
}

fn page_data(seq: u64, entries: &[Entry]) -> Value {
    json!({"user": {"__typename": "GraphqlUser", "id": "u1", "channelTimeline": {
        "__typename": "GraphqlChannelTimelinePage",
        "seq": seq.to_string(),
        "entries": entries.iter().map(message).collect::<Vec<_>>(),
    }}})
}

/// One write into the engine.
struct Write {
    query: &'static str,
    variables: Map<String, Value>,
    data: Value,
    commit: Option<ChannelTimelineCommit>,
}

fn commit(channel: &str) -> ChannelTimelineCommit {
    ChannelTimelineCommit {
        channel_id: channel.to_owned(),
        ..ChannelTimelineCommit::default()
    }
}

/// The write that stores `answer`.
fn write(answer: &Answer) -> Write {
    match answer {
        Answer::Page {
            list,
            seq,
            entries,
            span,
            reset,
        } => Write {
            query: PAGE.as_str(),
            variables: page_variables(list),
            data: page_data(*seq, entries),
            commit: Some(ChannelTimelineCommit {
                seq: Some(seq.to_string()),
                watermark: (!reset).then_some(ChannelWatermark::Lower),
                reset: *reset,
                coverage: span
                    .iter()
                    .map(|(start, end)| ChannelCoverage {
                        thread_root_id: list.thread.clone(),
                        span: TimelineSpan {
                            start: start.clone(),
                            end: end.clone(),
                        },
                    })
                    .collect(),
                ..commit(&list.channel)
            }),
        },
        Answer::Changes {
            channel,
            from,
            seq,
            entries,
            removed,
        } => Write {
            query: PAGE.as_str(),
            variables: Map::from_iter([(
                "input".to_owned(),
                json!({"channelId": channel, "after": "changes"}),
            )]),
            data: page_data(*seq, entries),
            commit: Some(ChannelTimelineCommit {
                seq: Some(seq.to_string()),
                watermark: Some(ChannelWatermark::Advance {
                    from: from.to_string(),
                }),
                removed_ids: removed.clone(),
                ..commit(channel)
            }),
        },
        Answer::Stamped {
            channel,
            seq,
            entry,
        } => Write {
            query: PAGE.as_str(),
            variables: Map::from_iter([(
                "input".to_owned(),
                json!({"channelId": channel, "after": "one"}),
            )]),
            data: page_data(*seq, std::slice::from_ref(entry)),
            commit: None,
        },
        Answer::Undated(entry) => Write {
            query: ONE.as_str(),
            variables: Map::from_iter([
                ("c".to_owned(), json!(entry.message.channel)),
                ("m".to_owned(), json!(entry.message.id)),
            ]),
            data: json!({"user": {
                "__typename": "GraphqlUser", "id": "u1", "channelMessage": flat(entry),
            }}),
            commit: None,
        },
    }
}

/// What the device answers a page read with.
pub struct Window {
    /// Newest first.
    pub ids: Vec<String>,
    pub older: Option<String>,
    pub newer: Option<String>,
}

pub struct Device<S: ChannelTimelineStorage> {
    engine: Engine<S>,
    sends: BTreeMap<String, (u64, MutationClaimToken)>,
}

impl<S: ChannelTimelineStorage> Device<S> {
    pub fn new(storage: S) -> Self {
        Self {
            engine: Engine::with_schema(storage, 64, SCHEMA.clone()),
            sends: BTreeMap::new(),
        }
    }

    /// Opens the stored cache again, with nothing in memory.
    pub fn reload(self, reopen: impl FnOnce(S) -> S) -> Self {
        Self::new(reopen(self.engine.into_storage()))
    }

    pub async fn store(&mut self, answer: &Answer) {
        let write = write(answer);
        let write = NetworkWrite {
            query: write.query,
            operation_name: None,
            variables: &write.variables,
            data: &write.data,
            identity: None,
            channel: write.commit.as_ref(),
        };
        self.engine
            .write_query_with_registration(None, None, write)
            .await
            .unwrap();
    }

    pub async fn touch(&mut self, channel: &str, now: i64) {
        let touch = ChannelTimelineCommit {
            touched_at_ms: Some(now),
            ..commit(channel)
        };
        self.engine.channel_timeline_commit(&touch).await.unwrap();
    }

    pub async fn drop_thread(&mut self, list: &List) {
        let drop = ChannelTimelineCommit {
            dropped_thread_root_ids: list.thread.iter().cloned().collect(),
            ..commit(&list.channel)
        };
        self.engine.channel_timeline_commit(&drop).await.unwrap();
    }

    /// Evicts the channels last touched before `before`.
    pub async fn evict(&mut self, before: i64) {
        self.engine
            .channel_timeline_evict(&ChannelEviction {
                touched_before_ms: before,
                max_channels: 1,
            })
            .await
            .unwrap();
    }

    /// Queues a new message; `false` when one is pending already.
    pub async fn send(&mut self, local: &str, list: &List) -> bool {
        if !self.sends.is_empty() {
            return false;
        }
        let binding = IdentityBinding {
            local_key: key(local),
            delete_record: false,
            response_path: ["sendMessage", "message"].map(Into::into).to_vec(),
            reference_fields: vec![],
            revalidation_variables: vec![],
        };
        let data = json!({"sendMessage": {"__typename": "MessageWrite", "seq": "0", "message": {
            "__typename": MESSAGE_TYPENAME,
            "id": local,
            "channelId": list.channel,
            "sortKey": "~",
            "threadId": list.thread,
            "deletedAt": null,
            "content": "0",
        }}});
        let queued = self
            .engine
            .enqueue_optimistic_mutation(
                None,
                BeginOptimisticWrite {
                    client_metadata: None,
                    uuid: "22222222-2222-4222-8222-222222222222",
                    query: SEND,
                    operation_name: None,
                    variables: &Map::new(),
                    data: &data,
                    link_patches: &[],
                    revalidations: &[],
                    created_at_ms: 0,
                    identity_bindings: std::slice::from_ref(&binding),
                },
                MutationClaimRequest {
                    owner: "runner".into(),
                    now_ms: 0,
                    lease_expires_at_ms: 100,
                },
            )
            .await
            .unwrap();
        let InitialClaimOutcome::Claimed(claimed) = queued.initial_claim else {
            panic!("the only queued mutation is claimable");
        };
        let claim = MutationClaimToken {
            owner: "runner".into(),
            generation: claimed.lease_generation,
        };
        self.sends
            .insert(local.to_owned(), (queued.transaction_id, claim));
        true
    }

    pub fn sending(&self) -> bool {
        !self.sends.is_empty()
    }

    /// The server's answer to a send; `None` when it refused.
    pub async fn settle(&mut self, local: &str, answer: Option<(u64, &Entry)>) {
        let Some((transaction, claim)) = self.sends.remove(local) else {
            return;
        };
        let Some((seq, entry)) = answer else {
            self.engine
                .rollback_optimistic_write(transaction, claim)
                .await
                .unwrap();
            return;
        };
        let data = json!({"sendMessage": {
            "__typename": "MessageWrite", "seq": seq.to_string(), "message": flat(entry),
        }});
        self.engine
            .commit_optimistic_write(transaction, claim, SEND, None, &Map::new(), &data)
            .await
            .unwrap();
    }

    /// The sequence up to which the channel's changes are applied.
    pub async fn watermark(&mut self, channel: &str) -> Option<u64> {
        let list = List {
            channel: channel.to_owned(),
            thread: None,
        };
        let request = request(&list, &Anchor::Latest, 1);
        let read = self.engine.channel_timeline(&request).await.unwrap().value;
        read.seq.map(|seq| seq.parse().unwrap())
    }

    /// A page of a list; `None` when the device cannot answer it.
    pub async fn window(&mut self, list: &List, anchor: &Anchor, limit: u16) -> Option<Window> {
        let request = request(list, anchor, limit);
        let read = self.engine.channel_timeline(&request).await.unwrap().value;
        read.covered.then(|| Window {
            ids: read
                .keys
                .iter()
                .filter_map(|key| key.id().map(str::to_owned))
                .filter(|id| !id.starts_with("local"))
                .collect(),
            older: read.older_cursor,
            newer: read.newer_cursor,
        })
    }

    /// The version held of a message.
    pub async fn version(&mut self, id: &str) -> Option<u64> {
        let records = self.engine.storage().get_batch(&[key(id)]).await.unwrap();
        match records.into_iter().next()??.fields.remove("content")? {
            CacheValue::String(content) => content.parse().ok(),
            _ => None,
        }
    }

    /// Every message the stored page of `list` still shows, previews included.
    pub async fn shown(&mut self, list: &List) -> HashSet<String> {
        let read = self
            .engine
            .read_query(None, &PAGE, None, &page_variables(list))
            .await
            .unwrap();
        let mut shown = HashSet::new();
        if let ReadResult::Hit { data } = read {
            collect_ids(&data["user"]["channelTimeline"]["entries"], &mut shown);
        }
        shown
    }
}

fn collect_ids(value: &Value, ids: &mut HashSet<String>) {
    match value {
        Value::Array(values) => values.iter().for_each(|value| collect_ids(value, ids)),
        Value::Object(fields) => {
            if let Some(id) = fields.get("id").and_then(Value::as_str) {
                ids.insert(id.to_owned());
            }
            fields.values().for_each(|value| collect_ids(value, ids));
        }
        _ => {}
    }
}

fn request(list: &List, anchor: &Anchor, limit: u16) -> ChannelTimelineRequest {
    let (before, after) = match anchor {
        Anchor::Latest => (None, None),
        Anchor::Before(before) => (Some(before.clone()), None),
        Anchor::After(after) => (None, Some(after.clone())),
    };
    ChannelTimelineRequest {
        channel_id: list.channel.clone(),
        thread_root_id: list.thread.clone(),
        limit,
        before,
        after,
        around: None,
    }
}
