use cache_core::channel_timeline::{
    ChannelCoverage, ChannelEviction, ChannelSeqUpdate, ChannelTimelineCommit,
    ChannelTimelineRequest, MESSAGE_TYPENAME, TIMELINE_HEAD, TIMELINE_START, TimelineSpan,
};
use cache_core::engine::{BeginOptimisticWrite, Engine, InitialClaimOutcome};
use cache_core::identity::IdentityBinding;
use cache_core::queue::{MutationClaimRequest, MutationClaimToken};
use cache_core::store::InMemoryStorage;
use cache_core::value::{CacheValue, EntityKey, Record};
use pollster::block_on;
use serde_json::json;

const MUTATION: &str = "mutation Save { setEntityProperty { __typename id displayName } }";
const UUID: &str = "22222222-2222-4222-8222-222222222222";

fn key(id: &str) -> EntityKey<'static> {
    EntityKey::entity(MESSAGE_TYPENAME, &[id])
}

fn text(value: &str) -> CacheValue {
    CacheValue::String(value.into())
}

fn message(
    channel: &str,
    id: &str,
    sort_key: &str,
    thread: Option<&str>,
) -> (EntityKey<'static>, Record) {
    let mut record = Record::default();
    for (field, value) in [
        ("__typename", text(MESSAGE_TYPENAME)),
        ("id", text(id)),
        ("channelId", text(channel)),
        ("sortKey", text(sort_key)),
        ("threadId", thread.map_or(CacheValue::Null, text)),
        ("deletedAt", CacheValue::Null),
    ] {
        record.fields.insert(field.into(), value);
    }
    (key(id), record)
}

/// Channel c1 with roots m1..m6 at sort keys 10..60, two replies under m3,
/// and one root in channel c2.
async fn seeded() -> Engine<InMemoryStorage> {
    let mut entries = (1..=6)
        .map(|n| message("c1", &format!("m{n}"), &format!("{n}0"), None))
        .collect::<Vec<_>>();
    entries.push(message("c1", "r1", "~-31", Some("m3")));
    entries.push(message("c1", "r2", "~-32", Some("m3")));
    entries.push(message("c2", "x1", "10", None));
    let mut engine = Engine::new(InMemoryStorage::new());
    engine
        .put_records_with_projections(None, entries, Vec::new())
        .await
        .unwrap();
    engine
}

fn latest(channel: &str, limit: u16) -> ChannelTimelineRequest {
    ChannelTimelineRequest {
        channel_id: channel.into(),
        thread_root_id: None,
        limit,
        before: None,
        after: None,
        around: None,
    }
}

fn coverage(thread: Option<&str>, start: &str, end: &str) -> ChannelCoverage {
    ChannelCoverage {
        thread_root_id: thread.map(Into::into),
        span: TimelineSpan {
            start: start.into(),
            end: end.into(),
        },
    }
}

fn commit(channel: &str) -> ChannelTimelineCommit {
    ChannelTimelineCommit {
        channel_id: channel.into(),
        ..ChannelTimelineCommit::default()
    }
}

fn lower(seq: &str) -> Option<ChannelSeqUpdate> {
    Some(ChannelSeqUpdate::Lower { seq: seq.into() })
}

fn advance(from: &str, to: &str) -> Option<ChannelSeqUpdate> {
    Some(ChannelSeqUpdate::Advance {
        from: from.into(),
        to: to.into(),
    })
}

fn ids<'a>(keys: &'a [EntityKey<'static>]) -> Vec<&'a str> {
    keys.iter().filter_map(EntityKey::id).collect()
}

#[test]
fn nothing_is_answered_before_a_stretch_is_committed() {
    block_on(async {
        let mut engine = seeded().await;
        let page = engine.channel_timeline(&latest("c1", 3)).await.unwrap();
        assert!(!page.covered && page.keys.is_empty() && page.seq.is_none());
    });
}

#[test]
fn pages_are_answered_inside_committed_stretches() {
    block_on(async {
        let mut engine = seeded().await;
        let committed = engine
            .channel_timeline_commit(&ChannelTimelineCommit {
                coverage: vec![coverage(None, "40", TIMELINE_HEAD)],
                seq: lower("7"),
                ..commit("c1")
            })
            .await
            .unwrap();
        assert_eq!(committed.seq.as_deref(), Some("7"));
        assert!(committed.write.changed.is_empty());

        let page = engine.channel_timeline(&latest("c1", 2)).await.unwrap();
        assert!(page.covered);
        assert_eq!(ids(&page.keys), ["m6", "m5"]);
        assert_eq!(page.older_cursor.as_deref(), Some("50"));
        assert_eq!(page.newer_cursor, None);
        assert_eq!(page.seq.as_deref(), Some("7"));

        // The next page is short: the stretch ends at m4 although m3 is cached.
        let mut older = latest("c1", 2);
        older.before = page.older_cursor.clone();
        let page = engine.channel_timeline(&older).await.unwrap();
        assert_eq!(ids(&page.keys), ["m4"]);
        assert_eq!(page.older_cursor.as_deref(), Some("40"));
        // Below the stretch the server has to answer.
        older.before = Some("40".into());
        assert!(!engine.channel_timeline(&older).await.unwrap().covered);

        // The fetched older page extends the stretch to the first message.
        engine
            .channel_timeline_commit(&ChannelTimelineCommit {
                coverage: vec![coverage(None, TIMELINE_START, "40")],
                seq: lower("9"),
                ..commit("c1")
            })
            .await
            .unwrap();
        let page = engine.channel_timeline(&older).await.unwrap();
        assert_eq!(ids(&page.keys), ["m3", "m2"]);
        // A page read at a later sequence never raises the channel's.
        assert_eq!(page.seq.as_deref(), Some("7"));
        older.before = Some("20".into());
        let page = engine.channel_timeline(&older).await.unwrap();
        assert_eq!(
            (ids(&page.keys), page.older_cursor.clone()),
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
            .channel_timeline_commit(&ChannelTimelineCommit {
                coverage: vec![
                    coverage(None, "20", "50"),
                    coverage(Some("m3"), TIMELINE_START, TIMELINE_HEAD),
                ],
                seq: lower("7"),
                ..commit("c1")
            })
            .await
            .unwrap();
        let mut around = latest("c1", 3);
        around.around = Some(key("r2"));
        let page = engine.channel_timeline(&around).await.unwrap();
        assert_eq!(ids(&page.keys), ["m4", "m3", "m2"]);
        assert_eq!(page.older_cursor.as_deref(), Some("20"));
        assert_eq!(page.newer_cursor.as_deref(), Some("40"));

        let mut thread = latest("c1", 10);
        thread.thread_root_id = Some("m3".into());
        let page = engine.channel_timeline(&thread).await.unwrap();
        assert_eq!(ids(&page.keys), ["r2", "r1"]);
        assert_eq!(
            (page.older_cursor.clone(), page.newer_cursor.clone()),
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
        let apply = |seq: Option<ChannelSeqUpdate>| ChannelTimelineCommit {
            seq,
            ..commit("c1")
        };
        let stored = engine
            .channel_timeline_commit(&apply(lower("7")))
            .await
            .unwrap();
        assert_eq!(stored.seq.as_deref(), Some("7"));
        let next = engine
            .channel_timeline_commit(&apply(advance("7", "8")))
            .await
            .unwrap();
        assert_eq!(next.seq.as_deref(), Some("8"));
        // Change 10 arrives while 9 is missing: the stored sequence stays, so
        // the caller knows to fetch the changes in between.
        let gap = engine
            .channel_timeline_commit(&apply(advance("9", "10")))
            .await
            .unwrap();
        assert_eq!(gap.seq.as_deref(), Some("8"));
        let caught_up = engine
            .channel_timeline_commit(&apply(advance("8", "10")))
            .await
            .unwrap();
        assert_eq!(caught_up.seq.as_deref(), Some("10"));
    });
}

#[test]
fn removals_dropped_threads_and_resets_delete_records() {
    block_on(async {
        let mut engine = seeded().await;
        engine
            .channel_timeline_commit(&ChannelTimelineCommit {
                coverage: vec![
                    coverage(None, TIMELINE_START, TIMELINE_HEAD),
                    coverage(Some("m3"), TIMELINE_START, TIMELINE_HEAD),
                ],
                seq: lower("7"),
                ..commit("c1")
            })
            .await
            .unwrap();

        let removed = engine
            .channel_timeline_commit(&ChannelTimelineCommit {
                removed_keys: vec![key("m2"), key("gone")],
                dropped_thread_root_ids: vec!["m3".into()],
                seq: advance("7", "8"),
                ..commit("c1")
            })
            .await
            .unwrap();
        assert_eq!(
            removed
                .write
                .changed
                .iter()
                .filter_map(EntityKey::id)
                .collect::<Vec<_>>(),
            ["m2", "r1", "r2"]
        );
        assert!(removed.write.revision_advanced);
        let page = engine.channel_timeline(&latest("c1", 10)).await.unwrap();
        assert_eq!(ids(&page.keys), ["m6", "m5", "m4", "m3", "m1"]);
        let mut thread = latest("c1", 10);
        thread.thread_root_id = Some("m3".into());
        assert!(!engine.channel_timeline(&thread).await.unwrap().covered);

        let reset = engine
            .channel_timeline_commit(&ChannelTimelineCommit {
                reset: true,
                seq: lower("20"),
                ..commit("c1")
            })
            .await
            .unwrap();
        assert_eq!(reset.seq.as_deref(), Some("20"));
        assert_eq!(reset.write.changed.len(), 5);
        let page = engine.channel_timeline(&latest("c1", 10)).await.unwrap();
        assert!(!page.covered);
        assert_eq!(page.seq.as_deref(), Some("20"));
        // Only the other channel's root is left.
        assert_eq!(engine.storage().len(), 1);
    });
}

#[test]
fn eviction_removes_the_channels_touched_longest_ago() {
    block_on(async {
        let mut engine = seeded().await;
        for (channel, touched_at_ms) in [("c1", 100), ("c2", 200)] {
            engine
                .channel_timeline_commit(&ChannelTimelineCommit {
                    coverage: vec![coverage(None, TIMELINE_START, TIMELINE_HEAD)],
                    seq: lower("1"),
                    touched_at_ms: Some(touched_at_ms),
                    ..commit(channel)
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

async fn enqueue_delete(
    engine: &mut Engine<InMemoryStorage>,
    message_key: &EntityKey<'static>,
) -> (u64, MutationClaimToken) {
    let result = engine
        .enqueue_optimistic_mutation(
            None,
            BeginOptimisticWrite {
                client_metadata: None,
                uuid: UUID,
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
        .unwrap();
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

#[test]
fn a_pending_delete_leaves_the_page_until_it_rolls_back() {
    block_on(async {
        let mut engine = seeded().await;
        engine
            .channel_timeline_commit(&ChannelTimelineCommit {
                coverage: vec![coverage(None, TIMELINE_START, TIMELINE_HEAD)],
                seq: lower("7"),
                ..commit("c1")
            })
            .await
            .unwrap();
        let (transaction, claim) = enqueue_delete(&mut engine, &key("m5")).await;
        let page = engine.channel_timeline(&latest("c1", 3)).await.unwrap();
        assert!(page.optimistic);
        assert_eq!(ids(&page.keys), ["m6", "m4", "m3"]);

        engine
            .rollback_optimistic_write(transaction, claim)
            .await
            .unwrap();
        let page = engine.channel_timeline(&latest("c1", 3)).await.unwrap();
        assert!(!page.optimistic);
        assert_eq!(ids(&page.keys), ["m6", "m5", "m4"]);
    });
}
