//! What a channel write may store, and what one transaction leaves.

use cache_core::channel_timeline::{
    ChannelCommitStatus, ChannelEviction, ChannelTimelineCommit, TIMELINE_HEAD, TIMELINE_START,
    TOMBSTONE_REPLAY,
};
use cache_core::engine::{
    BeginOptimisticWrite, Engine, EngineError, InitialClaimOutcome, NetworkWrite, ReadResult,
};
use cache_core::identity::IdentityBinding;
use cache_core::meta::{BUNDLED_SCHEMA_SDL, Schema, bundled_schema};
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::store::InMemoryStorage;
use pollster::block_on;
use serde_json::{Value, json};

#[path = "support/channels.rs"]
mod channels;
use channels::{
    TestEngine, changes, commit, content, coverage, key, latest, listed, message, page, removing,
    replies, saying, timeline_query, with_preview, write_page, write_undated,
};

fn root(id: &str, sort_key: &str) -> Value {
    message("c1", id, sort_key, None)
}

/// The whole channel: every root of `c1` is fetched.
fn whole(seq: &str) -> ChannelTimelineCommit {
    page(
        "c1",
        seq,
        vec![coverage(None, TIMELINE_START, TIMELINE_HEAD)],
    )
}

/// Roots m1..m3, read whole at sequence 10.
async fn held() -> TestEngine {
    let mut engine = Engine::new(InMemoryStorage::new());
    let entries = [root("m3", "30"), root("m2", "20"), root("m1", "10")];
    write_page(&mut engine, "c1", "10", &entries, Some(&whole("10")))
        .await
        .unwrap();
    engine
}

async fn roots(engine: &mut TestEngine) -> Option<Vec<String>> {
    listed(engine, &latest("c1", 100)).await
}

fn covered(ids: &[&str]) -> Option<Vec<String>> {
    Some(ids.iter().map(|id| (*id).to_owned()).collect())
}

async fn apply(
    engine: &mut TestEngine,
    seq: &str,
    entries: &[Value],
    commit: &ChannelTimelineCommit,
) -> (Option<String>, ChannelCommitStatus) {
    let write = write_page(engine, &commit.channel_id, seq, entries, Some(commit))
        .await
        .unwrap();
    let outcome = write.channel.unwrap();
    (outcome.seq, outcome.outcome)
}

#[test]
fn a_page_and_what_it_covers_are_one_write() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let entries = [root("m2", "20"), root("m1", "10")];
        let write = write_page(&mut engine, "c1", "10", &entries, Some(&whole("10")))
            .await
            .unwrap();
        assert!(write.revision_advanced);
        assert_eq!(roots(&mut engine).await, covered(&["m2", "m1"]));

        // The same page again changes nothing a read sees.
        let again = write_page(&mut engine, "c1", "10", &entries, Some(&whole("10")))
            .await
            .unwrap();
        assert!(!again.revision_advanced);

        // A commit that cannot apply keeps its entries out too.
        let broken = ChannelTimelineCommit {
            watermark: None,
            ..whole("11")
        };
        let error = write_page(&mut engine, "c1", "11", &[root("m3", "30")], Some(&broken)).await;
        assert!(matches!(error, Err(EngineError::ChannelTimeline(_))));
        assert_eq!(content(&mut engine, "m3").await, None);
    });
}

#[test]
fn older_content_never_replaces_newer() {
    block_on(async {
        let mut engine = held().await;
        let edited = saying(root("m2", "20"), "edited");
        let frame = changes("c1", "10", "12");
        apply(&mut engine, "12", std::slice::from_ref(&edited), &frame).await;

        // A page that left the server first arrives last: it covers what it
        // lists, and takes the channel back to its sequence.
        let late = [root("m3", "30"), root("m2", "20")];
        let outcome = apply(&mut engine, "11", &late, &whole("11")).await;
        assert_eq!(outcome, (Some("11".into()), ChannelCommitStatus::Applied));
        assert_eq!(content(&mut engine, "m2").await.as_deref(), Some("edited"));

        // Nor does content of no known age.
        write_undated(&mut engine, &root("m2", "20")).await;
        assert_eq!(content(&mut engine, "m2").await.as_deref(), Some("edited"));
        // Content as new does.
        let same = saying(root("m2", "20"), "edited again");
        apply(&mut engine, "12", &[same], &changes("c1", "11", "12")).await;
        assert_eq!(
            content(&mut engine, "m2").await.as_deref(),
            Some("edited again")
        );
    });
}

#[test]
fn a_removed_entry_stays_removed_for_every_older_answer() {
    block_on(async {
        let mut engine = held().await;
        let removal = removing(changes("c1", "10", "12"), &["m2"]);
        apply(&mut engine, "12", &[], &removal).await;
        assert_eq!(roots(&mut engine).await, covered(&["m3", "m1"]));
        assert_eq!(content(&mut engine, "m2").await, None);

        // A page read before the removal, with its coverage.
        apply(&mut engine, "11", &[root("m2", "20")], &whole("11")).await;
        // A preview without a commit, and content without a sequence.
        write_page(&mut engine, "c1", "11", &[root("m2", "20")], None)
            .await
            .unwrap();
        write_undated(&mut engine, &root("m2", "20")).await;
        assert_eq!(roots(&mut engine).await, covered(&["m3", "m1"]));
        assert_eq!(content(&mut engine, "m2").await, None);

        // The same removal again, and an older one, change nothing.
        for (seq, commit) in [("12", changes("c1", "11", "12")), ("9", commit("c1"))] {
            let mut commit = removing(commit, &["m2"]);
            commit.seq = Some(seq.into());
            let write = engine.channel_timeline_commit(&commit).await.unwrap();
            assert!(!write.changed.contains(&key("m2")));
        }

        // Content as new as the removal says it is back.
        apply(
            &mut engine,
            "13",
            &[root("m2", "20")],
            &changes("c1", "12", "13"),
        )
        .await;
        assert_eq!(roots(&mut engine).await, covered(&["m3", "m2", "m1"]));
    });
}

#[test]
fn a_removal_older_than_what_is_held_is_ignored() {
    block_on(async {
        let mut engine = held().await;
        let edited = saying(root("m2", "20"), "edited");
        apply(&mut engine, "12", &[edited], &changes("c1", "10", "12")).await;
        let mut late = removing(commit("c1"), &["m2"]);
        late.seq = Some("11".into());
        engine.channel_timeline_commit(&late).await.unwrap();
        assert_eq!(roots(&mut engine).await, covered(&["m3", "m2", "m1"]));
    });
}

#[test]
fn a_removal_of_an_entry_not_held_keeps_an_older_answer_out() {
    block_on(async {
        let mut engine = held().await;
        let removal = removing(changes("c1", "10", "12"), &["m9"]);
        let write = engine.channel_timeline_commit(&removal).await.unwrap();
        assert!(write.changed.is_empty());
        // Its page lowers the watermark under the removal, and lists it.
        apply(&mut engine, "11", &[root("m9", "90")], &whole("11")).await;
        assert_eq!(roots(&mut engine).await, covered(&["m3", "m2", "m1"]));
    });
}

#[test]
fn an_entry_not_held_is_known_gone_as_of_the_watermark() {
    block_on(async {
        let mut engine = held().await;
        // Delayed past the watermark: whatever it has was removed since.
        write_page(&mut engine, "c1", "9", &[root("m4", "40")], None)
            .await
            .unwrap();
        assert_eq!(roots(&mut engine).await, covered(&["m3", "m2", "m1"]));
        assert_eq!(content(&mut engine, "m4").await, None);
        // At the watermark or after it: a frame that overtook the changes.
        write_page(&mut engine, "c1", "14", &[root("m5", "50")], None)
            .await
            .unwrap();
        assert_eq!(roots(&mut engine).await, covered(&["m5", "m3", "m2", "m1"]));
    });
}

#[test]
fn changes_that_skip_some_apply_their_entries_and_keep_the_watermark() {
    block_on(async {
        let mut engine = held().await;
        let skipping = removing(changes("c1", "14", "15"), &["m1"]);
        let outcome = apply(&mut engine, "15", &[root("m4", "40")], &skipping).await;
        assert_eq!(outcome, (Some("10".into()), ChannelCommitStatus::Gap));
        assert_eq!(roots(&mut engine).await, covered(&["m4", "m3", "m2"]));

        let stale = changes("c1", "8", "9");
        let outcome = apply(&mut engine, "9", &[saying(root("m2", "20"), "old")], &stale).await;
        assert_eq!(outcome, (Some("10".into()), ChannelCommitStatus::Stale));
        assert_eq!(content(&mut engine, "m2").await.as_deref(), Some("m2"));
    });
}

#[test]
fn changes_of_a_channel_not_followed_store_nothing() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let frame = changes("c1", "10", "11");
        let outcome = apply(&mut engine, "11", &[root("m1", "10")], &frame).await;
        assert_eq!(outcome, (None, ChannelCommitStatus::Unheld));
        assert_eq!(content(&mut engine, "m1").await, None);

        // A preview is held; the removal of it still counts.
        write_page(&mut engine, "c1", "12", &[root("m2", "20")], None)
            .await
            .unwrap();
        let removal = removing(changes("c1", "12", "13"), &["m2"]);
        let outcome = apply(&mut engine, "13", &[], &removal).await;
        assert_eq!(outcome, (None, ChannelCommitStatus::Unheld));
        assert_eq!(content(&mut engine, "m2").await, None);
        write_page(&mut engine, "c1", "12", &[root("m2", "20")], None)
            .await
            .unwrap();
        assert_eq!(content(&mut engine, "m2").await, None);
    });
}

#[test]
fn the_first_page_drops_older_previews_it_does_not_list() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let previews = [root("m1", "10"), root("m2", "20")];
        write_page(&mut engine, "c1", "5", &previews, None)
            .await
            .unwrap();
        write_page(&mut engine, "c1", "12", &[root("m4", "40")], None)
            .await
            .unwrap();
        // m1 was deleted between the preview and the page, and no change said
        // so; m4 was sent after the page was read.
        let entries = [root("m3", "30"), root("m2", "20")];
        apply(&mut engine, "10", &entries, &whole("10")).await;
        assert_eq!(roots(&mut engine).await, covered(&["m4", "m3", "m2"]));
        assert_eq!(content(&mut engine, "m1").await, None);
    });
}

#[test]
fn a_reset_replaces_everything_held() {
    block_on(async {
        let mut engine = held().await;
        apply(
            &mut engine,
            "12",
            &[],
            &removing(changes("c1", "10", "12"), &["m3"]),
        )
        .await;
        let reset = ChannelTimelineCommit {
            reset: true,
            ..whole("8")
        };
        // Older than what it replaces: what the server has is the truth now.
        let entries = [root("m3", "30"), saying(root("m2", "20"), "restored")];
        let outcome = apply(&mut engine, "8", &entries, &reset).await;
        assert_eq!(outcome, (Some("8".into()), ChannelCommitStatus::Applied));
        assert_eq!(roots(&mut engine).await, covered(&["m3", "m2"]));
        assert_eq!(
            content(&mut engine, "m2").await.as_deref(),
            Some("restored")
        );
        assert_eq!(content(&mut engine, "m1").await, None);
    });
}

#[test]
fn removals_are_remembered_as_far_as_the_server_replays() {
    block_on(async {
        let mut engine = held().await;
        let removal = removing(changes("c1", "10", "12"), &["m2"]);
        apply(&mut engine, "12", &[], &removal).await;
        // Held by the removal alone while a catch-up could start below it.
        let near = (11 + TOMBSTONE_REPLAY).to_string();
        apply(&mut engine, &near, &[], &changes("c1", "12", &near)).await;
        let records = engine.storage().len();
        let far = (12 + TOMBSTONE_REPLAY).to_string();
        apply(&mut engine, &far, &[], &changes("c1", &near, &far)).await;
        assert_eq!(engine.storage().len(), records - 1);
        // The watermark keeps the same answers out.
        write_page(&mut engine, "c1", "11", &[root("m2", "20")], None)
            .await
            .unwrap();
        assert_eq!(content(&mut engine, "m2").await, None);
    });
}

#[test]
fn a_deletion_the_changes_do_not_explain_drops_its_coverage() {
    block_on(async {
        let mut engine = held().await;
        engine.delete_keys(&[key("m2")]).await.unwrap();
        assert_eq!(roots(&mut engine).await, None);
        // An entry of another list leaves the channel's alone.
        let mut engine = held().await;
        let reply = message("c1", "r1", "~-1", Some("m1"));
        let replies_commit = page(
            "c1",
            "10",
            vec![coverage(Some("m1"), TIMELINE_START, TIMELINE_HEAD)],
        );
        apply(&mut engine, "10", &[reply], &replies_commit).await;
        assert_eq!(
            listed(&mut engine, &replies("c1", "m1")).await,
            covered(&["r1"])
        );
        engine.delete_keys(&[key("r1")]).await.unwrap();
        assert_eq!(listed(&mut engine, &replies("c1", "m1")).await, None);
        assert!(roots(&mut engine).await.is_some());
    });
}

#[test]
fn eviction_finds_a_channel_only_previews_were_stored_of() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        write_page(&mut engine, "c1", "5", &[root("m1", "10")], None)
            .await
            .unwrap();
        let evicted = engine
            .channel_timeline_evict(&ChannelEviction {
                touched_before_ms: 1,
                max_channels: 5,
            })
            .await
            .unwrap();
        assert_eq!(evicted.channel_ids, ["c1"]);
        assert_eq!(content(&mut engine, "m1").await, None);
        let stats = engine.channel_timeline_stats().await.unwrap();
        assert_eq!((stats.channels, stats.entries), (0, 0));
    });
}

async fn read_page(engine: &mut TestEngine) -> Option<Value> {
    let variables = json!({"input": {"channelId": "c1"}});
    let read = engine
        .read_query(
            None,
            &timeline_query(),
            None,
            variables.as_object().unwrap(),
        )
        .await
        .unwrap();
    match read {
        ReadResult::Hit { mut data } => Some(data["user"]["channelTimeline"]["entries"].take()),
        ReadResult::Miss => None,
    }
}

fn preview_ids(entries: &Value) -> Vec<&str> {
    entries[0]["thread"]["preview"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|reply| reply["id"].as_str())
        .collect()
}

#[test]
fn a_thread_preview_omits_replies_that_are_not_held() {
    block_on(async {
        let mut engine = Engine::new(InMemoryStorage::new());
        let reply = |id: &str, at: &str| message("c1", id, at, Some("m1"));
        let listed = with_preview(
            root("m1", "10"),
            &[reply("r1", "~1"), reply("r2", "~2"), reply("r3", "~3")],
        );
        apply(&mut engine, "10", &[listed], &whole("10")).await;
        // One reply is removed, one leaves with its thread.
        let removal = removing(changes("c1", "10", "11"), &["r1"]);
        engine.channel_timeline_commit(&removal).await.unwrap();
        engine.delete_keys(&[key("r2")]).await.unwrap();
        let entries = read_page(&mut engine).await.expect("the page is readable");
        assert_eq!(preview_ids(&entries), ["r3"]);
    });
}

#[test]
fn a_thread_preview_omits_a_reply_the_write_refused() {
    block_on(async {
        let mut engine = held().await;
        // The root is as new as the one held, its reply is gone by now.
        let listed = with_preview(root("m3", "30"), &[message("c1", "r1", "~1", Some("m3"))]);
        let removal = removing(changes("c1", "10", "12"), &["r1"]);
        apply(&mut engine, "12", &[], &removal).await;
        apply(&mut engine, "11", &[listed], &page("c1", "11", Vec::new())).await;
        assert_eq!(content(&mut engine, "r1").await, None);
        let entries = read_page(&mut engine).await.expect("the page is readable");
        assert_eq!(preview_ids(&entries), Vec::<&str>::new());
    });
}

fn mutation_schema() -> std::sync::Arc<Schema> {
    let sdl = format!(
        "{BUNDLED_SCHEMA_SDL}\nextend type {} {{ sendMessage: MessageWrite! }}\n\
         type MessageWrite {{ message: GraphqlChannelMessage! seq: String! }}",
        bundled_schema().mutation_root().unwrap()
    );
    Schema::from_sdl(&sdl).unwrap()
}

const SEND: &str = "mutation { sendMessage { __typename seq message { __typename id channelId \
     sortKey threadId deletedAt content } } }";

fn sent(seq: &str, message: &Value) -> Value {
    json!({"sendMessage": {"__typename": "MessageWrite", "seq": seq, "message": message}})
}

/// Queues a mutation that answers `message`, sent new when `binds` its id.
async fn queue(engine: &mut TestEngine, message: &Value, binds: bool) -> (u64, MutationClaimToken) {
    let binding = IdentityBinding {
        local_key: key(message["id"].as_str().unwrap()),
        delete_record: false,
        response_path: ["sendMessage", "message"].map(Into::into).to_vec(),
        reference_fields: vec![],
        revalidation_variables: vec![],
    };
    let queued = engine
        .enqueue_optimistic_mutation(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid: "22222222-2222-4222-8222-222222222222",
                query: SEND,
                operation_name: None,
                variables: &Default::default(),
                data: &sent("0", message),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
                identity_bindings: if binds {
                    std::slice::from_ref(&binding)
                } else {
                    &[]
                },
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
    (queued.transaction_id, claim)
}

async fn settle(
    engine: &mut TestEngine,
    (transaction, claim): (u64, MutationClaimToken),
    data: &Value,
) {
    engine
        .commit_optimistic_write(transaction, claim, SEND, None, &Default::default(), data)
        .await
        .unwrap();
}

async fn held_with_mutations() -> TestEngine {
    let mut engine = Engine::with_schema(InMemoryStorage::new(), 100, mutation_schema());
    let entries = [root("m2", "20"), root("m1", "10")];
    write_page(&mut engine, "c1", "10", &entries, Some(&whole("10")))
        .await
        .unwrap();
    engine
}

#[test]
fn a_pending_send_outlives_a_reset_and_an_eviction_and_settles() {
    block_on(async {
        for reset in [true, false] {
            let mut engine = held_with_mutations().await;
            let pending = root("local", "\u{7e}");
            let claim = queue(&mut engine, &pending, true).await;
            assert_eq!(roots(&mut engine).await, covered(&["local", "m2", "m1"]));
            if reset {
                let reset = ChannelTimelineCommit {
                    reset: true,
                    ..whole("20")
                };
                apply(&mut engine, "20", &[root("m1", "10")], &reset).await;
            } else {
                engine
                    .channel_timeline_evict(&ChannelEviction {
                        touched_before_ms: 1,
                        max_channels: 5,
                    })
                    .await
                    .unwrap();
                apply(&mut engine, "20", &[root("m1", "10")], &whole("20")).await;
            }
            assert_eq!(roots(&mut engine).await, covered(&["local", "m1"]));
            settle(&mut engine, claim, &sent("21", &root("m5", "50"))).await;
            assert_eq!(roots(&mut engine).await, covered(&["m5", "m1"]));
        }
    });
}

#[test]
fn a_pending_edit_of_an_entry_that_leaves_the_device_shows_nothing_of_it() {
    block_on(async {
        let mut engine = held_with_mutations().await;
        let claim = queue(&mut engine, &saying(root("m2", "20"), "pending"), false).await;
        let removal = removing(changes("c1", "10", "11"), &["m2"]);
        apply(&mut engine, "11", &[], &removal).await;
        assert_eq!(roots(&mut engine).await, covered(&["m1"]));
        settle(&mut engine, claim, &sent("9", &root("m2", "20"))).await;
        assert_eq!(roots(&mut engine).await, covered(&["m1"]));
        assert_eq!(content(&mut engine, "m2").await, None);
    });
}

#[test]
fn a_settled_answer_never_replaces_newer_content() {
    block_on(async {
        let mut engine = held_with_mutations().await;
        let claim = queue(&mut engine, &saying(root("m2", "20"), "mine"), false).await;
        let frame = saying(root("m2", "20"), "theirs, after mine");
        apply(&mut engine, "14", &[frame], &changes("c1", "10", "14")).await;
        settle(
            &mut engine,
            claim,
            &sent("12", &saying(root("m2", "20"), "mine")),
        )
        .await;
        assert_eq!(
            content(&mut engine, "m2").await.as_deref(),
            Some("theirs, after mine")
        );
    });
}

#[test]
fn an_entry_is_as_new_as_the_oldest_answer_that_carries_it() {
    block_on(async {
        let mut engine = held().await;
        let query = "query ($page: ChannelTimelineInput!, $thread: ChannelThreadInput!) { user { \
             __typename id channelTimeline(input: $page) { __typename seq entries { __typename \
             ... on GraphqlChannelMessage { id channelId sortKey threadId deletedAt content } } } \
             channelThread(input: $thread) { __typename seq root { __typename id content } } } }";
        let variables =
            json!({"page": {"channelId": "c1"}, "thread": {"channelId": "c1", "rootId": "m4"}});
        let mut entry = root("m4", "40");
        entry.as_object_mut().unwrap().remove("thread");
        let data = json!({"user": {"__typename": "GraphqlUser", "id": "u1",
            "channelTimeline": {"__typename": "GraphqlChannelTimelinePage", "seq": "14", "entries": [entry]},
            "channelThread": {"__typename": "GraphqlChannelThreadPage", "seq": "12",
                "root": {"__typename": "GraphqlChannelMessage", "id": "m4", "content": "m4"}},
        }});
        let write = NetworkWrite {
            query,
            operation_name: None,
            variables: variables.as_object().unwrap(),
            data: &data,
            identity: None,
            channel: None,
        };
        engine
            .write_query_with_registration(None, None, write)
            .await
            .unwrap();
        for (seq, applied) in [("11", false), ("13", true)] {
            let mut removal = removing(commit("c1"), &["m4"]);
            removal.seq = Some(seq.into());
            engine.channel_timeline_commit(&removal).await.unwrap();
            assert_eq!(content(&mut engine, "m4").await.is_none(), applied, "{seq}");
        }
    });
}

#[test]
fn a_staged_page_commits_with_what_it_covers() {
    block_on(async {
        let mut engine = held().await;
        let query = timeline_query();
        let variables = json!({"input": {"channelId": "c1"}});
        let data = json!({"user": {"__typename": "GraphqlUser", "id": "u1", "channelTimeline": {
            "__typename": "GraphqlChannelTimelinePage", "seq": "12",
            "entries": [root("m4", "40"), root("m3", "30")],
        }}});
        let commit = removing(changes("c1", "10", "12"), &["m1"]);
        let write = NetworkWrite {
            query: &query,
            operation_name: None,
            variables: variables.as_object().unwrap(),
            data: &data,
            identity: None,
            channel: Some(&commit),
        };
        let staged = engine.stage_hydrate(write, None, &[]).await.unwrap();
        assert_eq!(roots(&mut engine).await, covered(&["m3", "m2", "m1"]));
        let written = engine
            .commit_staged_hydrate(staged.unwrap(), Vec::new())
            .await
            .unwrap();
        let outcome = written.write_result.channel.unwrap();
        assert_eq!(
            (outcome.seq.as_deref(), outcome.outcome),
            (Some("12"), ChannelCommitStatus::Applied)
        );
        assert_eq!(roots(&mut engine).await, covered(&["m4", "m3", "m2"]));
    });
}
