use super::*;
use cache_core::channel_timeline::{
    ChannelCoverage, ChannelSeqUpdate, TIMELINE_HEAD, TIMELINE_START,
};
use cache_core::value::CacheValue;
use pollster::block_on;

fn key(id: &str) -> EntityKey<'static> {
    EntityKey::entity(MESSAGE_TYPENAME, &[id])
}

fn string(value: &str) -> CacheValue {
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
        ("__typename", string(MESSAGE_TYPENAME)),
        ("id", string(id)),
        ("channelId", string(channel)),
        ("sortKey", string(sort_key)),
        ("threadId", thread.map_or(CacheValue::Null, string)),
        ("deletedAt", CacheValue::Null),
        (
            "content",
            string("hello there, this is a message of ordinary length"),
        ),
    ] {
        record.fields.insert(field.into(), value);
    }
    (key(id), record)
}

/// Channel c1 with roots m1..m6 at sort keys 10..60, two replies under m3,
/// and one root in channel c2.
fn seed() -> Vec<(EntityKey<'static>, Record)> {
    let mut entries = (1..=6)
        .map(|n| message("c1", &format!("m{n}"), &format!("{n}0"), None))
        .collect::<Vec<_>>();
    entries.push(message("c1", "r1", "~-31", Some("m3")));
    entries.push(message("c1", "r2", "~-32", Some("m3")));
    entries.push(message("c2", "x1", "10", None));
    entries
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

fn span(start: &str, end: &str) -> TimelineSpan {
    TimelineSpan {
        start: start.into(),
        end: end.into(),
    }
}

fn coverage(thread: Option<&str>, start: &str, end: &str) -> ChannelCoverage {
    ChannelCoverage {
        thread_root_id: thread.map(Into::into),
        span: span(start, end),
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

fn ids(rows: &[ChannelTimelineRow]) -> Vec<&str> {
    rows.iter().filter_map(|row| row.record_key.id()).collect()
}

fn raw_execute(storage: &TursoStorage, sql: &str) {
    driver::execute(&storage.connection(), sql, Vec::new()).unwrap();
}

fn scalar(storage: &TursoStorage, sql: &str) -> i64 {
    let rows = driver::query(&storage.connection(), sql, Vec::new()).unwrap();
    required_i64(&rows[0], 0).unwrap()
}

#[test]
fn timeline_rows_are_written_through_with_records() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("channel-write-through").unwrap();
        storage.put_batch(seed()).await.unwrap();
        assert_eq!(scalar(&storage, ROW_COUNT), 9);

        // A deleted reply stays indexed but hidden; a record that stops being
        // an entry loses its row; a deleted record loses its row.
        let mut tombstone = message("c1", "r1", "~-31", Some("m3"));
        tombstone
            .1
            .fields
            .insert("deletedAt".into(), string("2026-01-01T00:00:00Z"));
        let mut moved = message("c1", "m6", "60", None);
        moved.1.fields.remove("sortKey");
        storage.put_batch(vec![tombstone, moved]).await.unwrap();
        storage.delete_batch(&[key("m5")]).await.unwrap();
        assert_eq!(scalar(&storage, ROW_COUNT), 7);
        assert_eq!(
            scalar(
                &storage,
                "SELECT COUNT(*) FROM channel_timeline WHERE hidden = 1"
            ),
            1
        );

        storage.clear().await.unwrap();
        assert_eq!(scalar(&storage, ROW_COUNT), 0);
    });
}

#[test]
fn pages_read_inside_the_stretch_holding_their_anchor() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("channel-pages").unwrap();
        storage.put_batch(seed()).await.unwrap();
        let none = storage
            .query_channel_timeline(&latest("c1", 2))
            .await
            .unwrap();
        assert_eq!(none, ChannelTimelineSnapshot::default());

        let outcome = storage
            .channel_timeline_commit(&ChannelTimelineCommit {
                coverage: vec![
                    coverage(None, "20", "40"),
                    coverage(None, "40", TIMELINE_HEAD),
                    coverage(Some("m3"), TIMELINE_START, TIMELINE_HEAD),
                ],
                seq: lower("7"),
                touched_at_ms: Some(5),
                ..commit("c1")
            })
            .await
            .unwrap();
        assert_eq!((outcome.seq, outcome.deleted_keys.len()), (Some(7), 0));

        let page = storage
            .query_channel_timeline(&latest("c1", 2))
            .await
            .unwrap();
        assert_eq!(page.span, Some(span("20", TIMELINE_HEAD)));
        // One more than the page, newest first.
        assert_eq!(ids(&page.older), ["m6", "m5", "m4"]);
        assert_eq!(page.seq, Some(7));

        let mut before = latest("c1", 2);
        before.before = Some("40".into());
        let page = storage.query_channel_timeline(&before).await.unwrap();
        assert_eq!(ids(&page.older), ["m3", "m2"]);
        assert!(page.newer.is_empty());

        let mut after = latest("c1", 2);
        after.after = Some("20".into());
        let page = storage.query_channel_timeline(&after).await.unwrap();
        assert_eq!(ids(&page.newer), ["m3", "m4", "m5"]);

        // A reply anchors the channel read on its root.
        let mut around = latest("c1", 4);
        around.around = Some(key("r2"));
        let page = storage.query_channel_timeline(&around).await.unwrap();
        assert_eq!(
            page.anchor.as_ref().and_then(|row| row.record_key.id()),
            Some("m3")
        );
        assert_eq!(ids(&page.older), ["m2"]);
        assert_eq!(ids(&page.newer), ["m4", "m5", "m6"]);

        // m1 is cached but below every fetched stretch.
        around.around = Some(key("m1"));
        let page = storage.query_channel_timeline(&around).await.unwrap();
        assert_eq!((page.span, page.seq), (None, Some(7)));

        let mut thread = latest("c1", 5);
        thread.thread_root_id = Some("m3".into());
        let page = storage.query_channel_timeline(&thread).await.unwrap();
        assert_eq!(ids(&page.older), ["r2", "r1"]);

        assert_eq!(
            storage
                .query_channel_timeline(&latest("c2", 2))
                .await
                .unwrap()
                .span,
            None
        );
    });
}

#[test]
fn commits_persist_across_reopen_and_delete_what_they_name() {
    block_on(async {
        let database = TursoMemoryDatabase::new("channel-commit.db");
        let mut storage = database.open("scope").unwrap();
        storage.put_batch(seed()).await.unwrap();
        for channel in ["c1", "c2"] {
            storage
                .channel_timeline_commit(&ChannelTimelineCommit {
                    coverage: vec![
                        coverage(None, TIMELINE_START, TIMELINE_HEAD),
                        coverage(Some("m3"), TIMELINE_START, TIMELINE_HEAD),
                    ],
                    seq: lower("7"),
                    touched_at_ms: Some(if channel == "c1" { 100 } else { 200 }),
                    ..commit(channel)
                })
                .await
                .unwrap();
        }
        storage.try_close().unwrap();

        let mut storage = database.open("scope").unwrap();
        let page = storage
            .query_channel_timeline(&latest("c1", 10))
            .await
            .unwrap();
        assert_eq!(page.span, Some(span(TIMELINE_START, TIMELINE_HEAD)));
        assert_eq!(ids(&page.older), ["m6", "m5", "m4", "m3", "m2", "m1"]);
        assert_eq!(page.seq, Some(7));

        let outcome = storage
            .channel_timeline_commit(&ChannelTimelineCommit {
                removed_keys: vec![key("m2"), key("gone")],
                dropped_thread_root_ids: vec!["m3".into()],
                seq: Some(ChannelSeqUpdate::Advance {
                    from: "7".into(),
                    to: "8".into(),
                }),
                ..commit("c1")
            })
            .await
            .unwrap();
        assert_eq!(outcome.seq, Some(8));
        assert_eq!(
            outcome
                .deleted_keys
                .iter()
                .filter_map(EntityKey::id)
                .collect::<Vec<_>>(),
            ["m2", "r1", "r2"]
        );
        assert_eq!(
            storage.get_batch(&[key("m2"), key("r1")]).await.unwrap(),
            [None, None]
        );
        let mut thread = latest("c1", 5);
        thread.thread_root_id = Some("m3".into());
        assert_eq!(
            storage.query_channel_timeline(&thread).await.unwrap().span,
            None
        );
        // A push that skips a change leaves the sequence where it was.
        let gap = storage
            .channel_timeline_commit(&ChannelTimelineCommit {
                seq: Some(ChannelSeqUpdate::Advance {
                    from: "9".into(),
                    to: "10".into(),
                }),
                ..commit("c1")
            })
            .await
            .unwrap();
        assert_eq!(gap.seq, Some(8));

        let stats = storage.channel_timeline_stats().await.unwrap();
        assert_eq!((stats.channels, stats.entries), (2, 6));
        let evicted = storage
            .channel_timeline_evict(&ChannelEviction {
                touched_before_ms: 150,
                max_channels: 5,
            })
            .await
            .unwrap();
        assert_eq!(evicted.channel_ids, ["c1"]);
        assert_eq!(evicted.deleted_keys.len(), 5);
        assert!(!evicted.has_more);
        assert_eq!(
            storage
                .query_channel_timeline(&latest("c1", 10))
                .await
                .unwrap(),
            ChannelTimelineSnapshot::default()
        );

        let reset = storage
            .channel_timeline_commit(&ChannelTimelineCommit {
                reset: true,
                seq: lower("30"),
                ..commit("c2")
            })
            .await
            .unwrap();
        assert_eq!((reset.seq, reset.deleted_keys.len()), (Some(30), 1));
        let page = storage
            .query_channel_timeline(&latest("c2", 10))
            .await
            .unwrap();
        assert_eq!((page.span, page.seq), (None, Some(30)));
        assert_eq!(scalar(&storage, ROW_COUNT), 0);
        assert_eq!(scalar(&storage, "SELECT COUNT(*) FROM channel_coverage"), 0);
        assert_eq!(scalar(&storage, "SELECT COUNT(*) FROM records"), 0);
    });
}

#[test]
fn a_page_costs_the_same_in_a_small_and_a_large_channel() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("channel-scan-cost").unwrap();
        let mut costs = Vec::new();
        let mut written = 0;
        for total in [200, 20_000] {
            storage
                .put_batch(
                    (written..total)
                        .map(|n| message("c1", &format!("m{n}"), &format!("{n:020}-x"), None))
                        .chain(
                            (written..total).map(|n| {
                                message("c2", &format!("o{n}"), &format!("{n:020}-x"), None)
                            }),
                        )
                        .collect(),
                )
                .await
                .unwrap();
            written = total;
            let mut steps = 0;
            for (sql, low, high) in [
                (
                    ROWS_OLDER,
                    TIMELINE_START.to_owned(),
                    TIMELINE_HEAD.to_owned(),
                ),
                (
                    ROWS_OLDER,
                    TIMELINE_START.to_owned(),
                    format!("{:020}-x", 120),
                ),
                (
                    ROWS_NEWER,
                    format!("{:020}-x", 20),
                    TIMELINE_HEAD.to_owned(),
                ),
            ] {
                let mut statement = driver::prepare(&storage.connection(), sql).unwrap();
                let rows = driver::query_prepared(
                    &mut statement,
                    vec![text("c:c1"), text(&low), text(&high), Value::from_i64(51)],
                )
                .unwrap();
                assert_eq!(rows.len(), 51);
                steps += statement.metrics().vm_steps;
            }
            costs.push(steps);
        }
        assert!(
            costs[1] <= costs[0] + 50,
            "VM steps grew with the channel: {costs:?}"
        );
        for sql in [ROWS_OLDER, ROWS_NEWER, KEYS_BY_SCOPE, KEYS_BY_CHANNEL] {
            let parameters = vec![
                text("c:c1");
                driver::prepare(&storage.connection(), sql)
                    .unwrap()
                    .parameters_count()
            ];
            let plan = driver::query(
                &storage.connection(),
                &format!("EXPLAIN QUERY PLAN {sql}"),
                parameters,
            )
            .unwrap()
            .iter()
            .filter_map(|row| required_text(row, 3).ok())
            .collect::<Vec<_>>()
            .join(" ");
            assert!(plan.contains("channel_timeline_"), "{sql}: {plan}");
            assert!(!plan.contains("TEMP B-TREE"), "{sql}: {plan}");
        }
    });
}

#[test]
fn reopen_rebuilds_timeline_rows_after_a_projection_change() {
    block_on(async {
        let database = TursoMemoryDatabase::new("channel-projection.db");
        let mut storage = database.open("scope").unwrap();
        storage.put_batch(seed()).await.unwrap();
        storage
            .channel_timeline_commit(&ChannelTimelineCommit {
                coverage: vec![coverage(None, "30", TIMELINE_HEAD)],
                seq: lower("4"),
                ..commit("c1")
            })
            .await
            .unwrap();
        raw_execute(&storage, "DELETE FROM channel_timeline");
        raw_execute(
            &storage,
            "UPDATE meta SET value = '0' WHERE key = 'channel_timeline_projection_version'",
        );
        storage.try_close().unwrap();

        let storage = database.open("scope").unwrap();
        assert_eq!(scalar(&storage, ROW_COUNT), 9);
        let page = storage
            .query_channel_timeline(&latest("c1", 2))
            .await
            .unwrap();
        assert_eq!(page.span, Some(span("30", TIMELINE_HEAD)));
        assert_eq!(
            (ids(&page.older), page.seq),
            (vec!["m6", "m5", "m4"], Some(4))
        );
        storage.try_close().unwrap();

        // A normal reopen neither scans nor decodes message records.
        driver::arm_reset_failure(SEARCH_REBUILD_RECORDS);
        let storage = database.open("scope").unwrap();
        assert_eq!(scalar(&storage, ROW_COUNT), 9);
        storage.try_close().unwrap();
    });
}

#[test]
fn reopen_rejects_a_channel_schema_drift() {
    block_on(async {
        let database = TursoMemoryDatabase::new("channel-schema.db");
        let storage = database.open("scope").unwrap();
        raw_execute(&storage, "DROP INDEX channel_timeline_channel_idx");
        storage.try_close().unwrap();
        let Err(error) = database.open("scope") else {
            panic!("a drifted channel schema must not open");
        };
        assert_eq!(
            error.physical_reset_reason(),
            Some(PhysicalResetReason::Compatibility)
        );
    });
}

#[test]
fn invalid_commits_never_open_a_transaction() {
    block_on(async {
        let mut storage = TursoStorage::open_in_memory("channel-invalid").unwrap();
        let error = storage
            .channel_timeline_commit(&ChannelTimelineCommit {
                coverage: vec![coverage(None, "20", "10")],
                ..commit("c1")
            })
            .await
            .unwrap_err();
        assert!(!error.requires_physical_reset());
        let error = storage
            .channel_timeline_evict(&ChannelEviction {
                touched_before_ms: 1,
                max_channels: 0,
            })
            .await
            .unwrap_err();
        assert!(!error.requires_physical_reset());
        assert_eq!(scalar(&storage, SYNC_COUNT), 0);
    });
}
