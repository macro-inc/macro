use cache_core::channel_timeline::{
    ChannelCommitStatus, ChannelEviction, ChannelTimelineCommit, TIMELINE_HEAD, TIMELINE_START,
};
use cache_core::engine::{
    BeginOptimisticWrite, Engine, EngineError, EnqueueOptimisticMutationResult, InitialClaimOutcome,
};
use cache_core::identity::IdentityBinding;
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::store::InMemoryStorage;
use cache_core::value::EntityKey;
use pollster::block_on;
use serde_json::json;
use std::convert::Infallible;

#[path = "support/channels.rs"]
#[expect(dead_code, reason = "the commit tests use the rest")]
mod channels;
use channels::{
    TestEngine, changes, commit, coverage, ids, key, latest, message, page, removing, write_page,
};

const MUTATION: &str = "mutation Save { setEntityProperty { __typename id displayName } }";
const UUID: &str = "22222222-2222-4222-8222-222222222222";

/// Channel c1 with roots m1..m6 at sort keys 10..60, two replies under m3,
/// and one root in channel c2, all read at sequence 7.
async fn seeded() -> TestEngine {
    let mut entries = (1..=6)
        .map(|n| message("c1", &format!("m{n}"), &format!("{n}0"), None))
        .collect::<Vec<_>>();
    entries.push(message("c1", "r1", "~-31", Some("m3")));
    entries.push(message("c1", "r2", "~-32", Some("m3")));
    let mut engine = Engine::new(InMemoryStorage::new());
    write_page(&mut engine, "c1", "7", &entries, None)
        .await
        .unwrap();
    let other = message("c2", "x1", "10", None);
    write_page(&mut engine, "c2", "7", &[other], None)
        .await
        .unwrap();
    engine
}

#[test]
fn nothing_is_answered_before_a_stretch_is_committed() {
    block_on(async {
        let mut engine = seeded().await;
        let read = engine.channel_timeline(&latest("c1", 3)).await.unwrap();
        assert!(!read.covered && read.keys.is_empty() && read.seq.is_none());
    });
}

#[test]
fn pages_are_answered_inside_committed_stretches() {
    block_on(async {
        let mut engine = seeded().await;
        let outcome = engine
            .channel_timeline_commit(&page("c1", "7", vec![coverage(None, "40", TIMELINE_HEAD)]))
            .await
            .unwrap();
        assert!(outcome.changed.is_empty());
        let outcome = outcome.channel.unwrap();
        assert_eq!(
            (outcome.seq.as_deref(), outcome.outcome),
            (Some("7"), ChannelCommitStatus::Applied)
        );

        let read = engine.channel_timeline(&latest("c1", 2)).await.unwrap();
        assert!(read.covered);
        assert_eq!(ids(&read.keys), ["m6", "m5"]);
        assert_eq!(read.older_cursor.as_deref(), Some("50"));
        assert_eq!(read.newer_cursor, None);
        assert_eq!(read.seq.as_deref(), Some("7"));

        // The next page is short: the stretch ends at m4 although m3 is cached.
        let mut older = latest("c1", 2);
        older.before = read.older_cursor.clone();
        let read = engine.channel_timeline(&older).await.unwrap();
        assert_eq!(ids(&read.keys), ["m4"]);
        assert_eq!(read.older_cursor.as_deref(), Some("40"));
        // Below the stretch the server has to answer.
        older.before = Some("40".into());
        assert!(!engine.channel_timeline(&older).await.unwrap().covered);

        // The fetched older page extends the stretch to the first message.
        engine
            .channel_timeline_commit(&page("c1", "9", vec![coverage(None, TIMELINE_START, "40")]))
            .await
            .unwrap();
        let read = engine.channel_timeline(&older).await.unwrap();
        assert_eq!(ids(&read.keys), ["m3", "m2"]);
        // A page read at a later sequence never raises the channel's.
        assert_eq!(read.seq.as_deref(), Some("7"));
        older.before = Some("20".into());
        let read = engine.channel_timeline(&older).await.unwrap();
        assert_eq!(
            (ids(&read.keys), read.older_cursor.clone()),
            (vec!["m1"], None)
        );

        // Another channel is untouched.
        assert!(
            !engine
                .channel_timeline(&latest("c2", 2))
                .await
                .unwrap()
                .covered
        );
    });
}

#[test]
fn jumping_to_a_message_centres_on_it_and_a_reply_lands_on_its_root() {
    block_on(async {
        let mut engine = seeded().await;
        engine
            .channel_timeline_commit(&page(
                "c1",
                "7",
                vec![
                    coverage(None, "20", "50"),
                    coverage(Some("m3"), TIMELINE_START, TIMELINE_HEAD),
                ],
            ))
            .await
            .unwrap();
        let mut around = latest("c1", 3);
        around.around = Some(key("r2"));
        let read = engine.channel_timeline(&around).await.unwrap();
        assert_eq!(ids(&read.keys), ["m4", "m3", "m2"]);
        assert_eq!(read.older_cursor.as_deref(), Some("20"));
        assert_eq!(read.newer_cursor.as_deref(), Some("40"));

        let mut thread = latest("c1", 10);
        thread.thread_root_id = Some("m3".into());
        let read = engine.channel_timeline(&thread).await.unwrap();
        assert_eq!(ids(&read.keys), ["r2", "r1"]);
        assert_eq!(
            (read.older_cursor.clone(), read.newer_cursor.clone()),
            (None, None)
        );

        // m6 is cached but outside every fetched stretch, and m9 is unknown.
        for target in ["m6", "m9"] {
            around.around = Some(key(target));
            assert!(!engine.channel_timeline(&around).await.unwrap().covered);
        }
    });
}

#[test]
fn changes_apply_only_in_sequence() {
    block_on(async {
        let mut engine = seeded().await;
        use ChannelCommitStatus::{Applied, Gap, Stale, Unheld};
        for (commit, seq, outcome) in [
            (changes("c1", "6", "7"), None, Unheld),
            (page("c1", "7", Vec::new()), Some("7"), Applied),
            (changes("c1", "7", "8"), Some("8"), Applied),
            // Change 10 arrives while 9 is missing: the watermark stays, so
            // the caller knows to fetch the changes in between.
            (changes("c1", "9", "10"), Some("8"), Gap),
            (changes("c1", "8", "10"), Some("10"), Applied),
            (changes("c1", "9", "10"), Some("10"), Stale),
        ] {
            let write = engine.channel_timeline_commit(&commit).await.unwrap();
            let answer = write.channel.unwrap();
            assert_eq!(
                (answer.seq.as_deref(), answer.outcome),
                (seq, outcome),
                "{commit:?}"
            );
        }
    });
}

#[test]
fn removals_dropped_threads_and_resets_delete_records() {
    block_on(async {
        let mut engine = seeded().await;
        engine
            .channel_timeline_commit(&page(
                "c1",
                "7",
                vec![
                    coverage(None, TIMELINE_START, TIMELINE_HEAD),
                    coverage(Some("m3"), TIMELINE_START, TIMELINE_HEAD),
                ],
            ))
            .await
            .unwrap();

        let removed = engine
            .channel_timeline_commit(&ChannelTimelineCommit {
                dropped_thread_root_ids: vec!["m3".into()],
                ..removing(changes("c1", "7", "8"), &["m2", "gone"])
            })
            .await
            .unwrap();
        assert_eq!(
            removed
                .changed
                .iter()
                .filter_map(EntityKey::id)
                .collect::<Vec<_>>(),
            ["m2", "r1", "r2"]
        );
        assert!(removed.revision_advanced);
        let read = engine.channel_timeline(&latest("c1", 10)).await.unwrap();
        assert_eq!(ids(&read.keys), ["m6", "m5", "m4", "m3", "m1"]);
        let mut thread = latest("c1", 10);
        thread.thread_root_id = Some("m3".into());
        assert!(!engine.channel_timeline(&thread).await.unwrap().covered);

        let reset = engine
            .channel_timeline_commit(&ChannelTimelineCommit {
                reset: true,
                seq: Some("20".into()),
                ..commit("c1")
            })
            .await
            .unwrap();
        let seq = reset.channel.unwrap().seq;
        assert_eq!(seq.as_deref(), Some("20"));
        // The five roots, and the removals of either type under two ids.
        assert_eq!(reset.changed.len(), 5 + 4);
        let read = engine.channel_timeline(&latest("c1", 10)).await.unwrap();
        assert!(!read.covered);
        assert_eq!(read.seq.as_deref(), Some("20"));
        let left = engine.channel_timeline_stats().await.unwrap();
        assert_eq!(left.entries, 1, "the other channel keeps its root");
    });
}

#[test]
fn eviction_removes_the_channels_touched_longest_ago() {
    block_on(async {
        let mut engine = seeded().await;
        for (channel, touched_at_ms) in [("c1", 100), ("c2", 200)] {
            engine
                .channel_timeline_commit(&ChannelTimelineCommit {
                    touched_at_ms: Some(touched_at_ms),
                    ..page(
                        channel,
                        "7",
                        vec![coverage(None, TIMELINE_START, TIMELINE_HEAD)],
                    )
                })
                .await
                .unwrap();
        }
        let stats = engine.channel_timeline_stats().await.unwrap();
        assert_eq!((stats.channels, stats.entries), (2, 9));

        let evicted = engine
            .channel_timeline_evict(&ChannelEviction {
                touched_before_ms: 150,
                max_channels: 10,
            })
            .await
            .unwrap();
        assert_eq!(evicted.channel_ids, ["c1"]);
        assert!(!evicted.has_more);
        assert_eq!(evicted.write.changed.len(), 8);
        assert!(
            !engine
                .channel_timeline(&latest("c1", 5))
                .await
                .unwrap()
                .covered
        );
        let kept = engine.channel_timeline(&latest("c2", 5)).await.unwrap();
        assert_eq!(ids(&kept.keys), ["x1"]);
        let stats = engine.channel_timeline_stats().await.unwrap();
        assert_eq!((stats.channels, stats.entries), (1, 1));
    });
}

async fn queue_delete(engine: &mut Engine<InMemoryStorage>, message_key: &EntityKey<'static>) {
    let uuid = uuid::Uuid::now_v7().to_string();
    enqueue(engine, message_key, &uuid).await;
}

async fn enqueue_delete(
    engine: &mut Engine<InMemoryStorage>,
    message_key: &EntityKey<'static>,
) -> (u64, MutationClaimToken) {
    let result = enqueue(engine, message_key, UUID).await;
    let InitialClaimOutcome::Claimed(claimed) = result.initial_claim else {
        panic!("the only queued mutation is claimable");
    };
    (
        result.transaction_id,
        MutationClaimToken {
            owner: "runner".into(),
            generation: claimed.lease_generation,
        },
    )
}

async fn enqueue(
    engine: &mut Engine<InMemoryStorage>,
    message_key: &EntityKey<'static>,
    uuid: &str,
) -> EnqueueOptimisticMutationResult<EngineError<Infallible>> {
    engine
        .enqueue_optimistic_mutation(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid,
                query: MUTATION,
                operation_name: None,
                variables: &Default::default(),
                data: &json!({"setEntityProperty": {"__typename": "GraphqlProperty", "id": "p1", "displayName": "x"}}),
                link_patches: &[],
                revalidations: &[],
                created_at_ms: 0,
                identity_bindings: &[IdentityBinding {
                    local_key: message_key.clone(),
                    delete_record: true,
                    response_path: vec![],
                    reference_fields: vec![],
                    revalidation_variables: vec![],
                }],
            },
            MutationClaimRequest {
                owner: "runner".into(),
                now_ms: 0,
                lease_expires_at_ms: 100,
            },
        )
        .await
        .unwrap()
}

#[test]
fn a_pending_delete_leaves_the_page_until_it_rolls_back() {
    block_on(async {
        let mut engine = seeded().await;
        engine
            .channel_timeline_commit(&page(
                "c1",
                "7",
                vec![coverage(None, TIMELINE_START, TIMELINE_HEAD)],
            ))
            .await
            .unwrap();
        let (transaction, claim) = enqueue_delete(&mut engine, &key("m5")).await;
        let read = engine.channel_timeline(&latest("c1", 3)).await.unwrap();
        assert!(read.optimistic);
        assert_eq!(ids(&read.keys), ["m6", "m4", "m3"]);

        engine
            .rollback_optimistic_write(transaction, claim)
            .await
            .unwrap();
        let read = engine.channel_timeline(&latest("c1", 3)).await.unwrap();
        assert!(!read.optimistic);
        assert_eq!(ids(&read.keys), ["m6", "m5", "m4"]);
    });
}

#[test]
fn a_page_stays_full_when_pending_deletes_take_more_rows_than_its_lookahead() {
    block_on(async {
        let mut engine = seeded().await;
        engine
            .channel_timeline_commit(&page(
                "c1",
                "7",
                vec![coverage(None, TIMELINE_START, TIMELINE_HEAD)],
            ))
            .await
            .unwrap();
        for id in ["m6", "m5", "m4"] {
            queue_delete(&mut engine, &key(id)).await;
        }
        // The page and its lookahead row are all pending deletes: the three
        // entries below them are held and make the page.
        let read = engine.channel_timeline(&latest("c1", 2)).await.unwrap();
        assert!(read.covered && read.optimistic);
        assert_eq!(ids(&read.keys), ["m3", "m2"]);
        assert_eq!(read.older_cursor.as_deref(), Some("20"));

        let mut older = latest("c1", 2);
        older.before = Some("40".into());
        queue_delete(&mut engine, &key("m1")).await;
        let read = engine.channel_timeline(&older).await.unwrap();
        // m1 is a pending delete, so nothing older follows.
        assert_eq!(ids(&read.keys), ["m3", "m2"]);
        assert_eq!(read.older_cursor, None);
    });
}

#[test]
fn a_dropped_thread_takes_only_its_own_channels_rows() {
    block_on(async {
        let mut engine = seeded().await;
        // A root id of another channel: nothing in this one answers to it.
        let dropped = engine
            .channel_timeline_commit(&ChannelTimelineCommit {
                dropped_thread_root_ids: vec!["m3".into()],
                ..commit("c2")
            })
            .await
            .unwrap();
        assert!(dropped.changed.is_empty());
        let held = engine.channel_timeline_stats().await.unwrap();
        assert_eq!(held.entries, 9);
    });
}
