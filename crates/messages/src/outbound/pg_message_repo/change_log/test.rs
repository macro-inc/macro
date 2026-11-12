use chrono::{Duration, Utc};
use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType, ParticipantRole,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::domain::{
    changes::{ChannelChangeLogRetention, MAX_CHANGE_ROWS},
    historical::{HistoricalBatch, HistoricalBodyPatch, HistoricalMessage},
    models::{MessageKind, PostMessage},
    ports::{
        CreateMessage, EditMessage, HistoricalMessageRepository, MessageRepository,
        MessageTimelineEntry, NoMessageEventPublisher,
    },
    service::{MessageService, MessageView},
};

const USER: &str = "macro|change-log@example.com";

async fn channel(pool: &PgPool) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'Changes', 'private', $2)",
        id,
        USER,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

fn post(channel_id: Uuid, thread_id: Option<Uuid>, content: &str) -> CreateMessage {
    CreateMessage {
        kind: MessageKind::Message,
        guest_name: None,
        canonical_root_id: None,
        parent: MessageParent::Channel(channel_id),
        actor: USER.to_owned().try_into().unwrap(),
        triggered_via: None,
        triggered_by: None,
        input: PostMessage {
            id: None,
            attribution: Default::default(),
            notification_policy: Default::default(),
            content: content.into(),
            thread_id,
            anchor: None,
            mentions: vec![],
            attachments: vec![],
            nonce: None,
        },
    }
}

fn edit(content: &str) -> EditMessage {
    EditMessage {
        notification_policy: Default::default(),
        content: content.into(),
        mentions: vec![],
        attachments: None,
        nonce: None,
    }
}

fn viewer(channel_id: Uuid) -> EntityAccessReceipt<MessageView> {
    EntityAccessReceipt::try_new_authenticated_user(
        USER.to_owned().try_into().unwrap(),
        Entity {
            entity_type: EntityType::Channel,
            entity_id: channel_id.to_string(),
        },
        EntityPermission::ChannelRole {
            role: ParticipantRole::Member,
        },
    )
    .unwrap()
}

fn change(seq: i64, message_id: Uuid, root_id: Uuid) -> ChannelChange {
    ChannelChange {
        seq,
        op: ChannelChangeOp::Message {
            message_id,
            root_id,
        },
    }
}

fn sorted(mut ids: Vec<Uuid>) -> Vec<Uuid> {
    ids.sort();
    ids
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_channel_write_takes_the_next_sequence_number(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    assert_eq!(repo.channel_seq(channel_id).await.unwrap(), 0);

    let root = repo
        .create_sequenced(post(channel_id, None, "root"))
        .await
        .unwrap();
    assert_eq!(root.seq, Some(1));
    let root = root.value;
    let reply = repo
        .create_sequenced(post(channel_id, Some(root.id), "reply"))
        .await
        .unwrap();
    assert_eq!(reply.seq, Some(2));
    let reply = reply.value;
    let edited = repo
        .edit_sequenced(&parent, reply.id, edit("edited"))
        .await
        .unwrap();
    assert_eq!(edited.seq, Some(3));
    let reacted = repo
        .react(&parent, root.id, USER, "👍", true)
        .await
        .unwrap();
    assert_eq!((reacted.changed, reacted.seq), (true, Some(4)));
    // A repeat changes nothing, so it logs nothing.
    let repeated = repo
        .react(&parent, root.id, USER, "👍", true)
        .await
        .unwrap();
    assert_eq!((repeated.changed, repeated.seq), (false, None));
    let deleted = repo.delete_sequenced(&parent, reply.id).await.unwrap();
    assert_eq!(deleted.seq, Some(5));

    assert_eq!(repo.channel_seq(channel_id).await.unwrap(), 5);
    let log = repo
        .channel_change_log(channel_id, 1, MAX_CHANGE_ROWS)
        .await
        .unwrap();
    assert_eq!(log.counter, 5);
    assert_eq!(
        log.changes,
        [
            change(2, reply.id, root.id),
            change(3, reply.id, root.id),
            change(4, root.id, root.id),
            change(5, reply.id, root.id),
        ]
    );
    // A page ends where its limit does.
    let page = repo.channel_change_log(channel_id, 1, 2).await.unwrap();
    assert_eq!(page.counter, 5);
    assert_eq!(
        page.changes.iter().map(|c| c.seq).collect::<Vec<_>>(),
        [2, 3]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_write_takes_no_sequence_number(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let missing_root = Uuid::now_v7();
    assert!(
        repo.create_sequenced(post(channel_id, Some(missing_root), "orphan"))
            .await
            .is_err()
    );
    assert_eq!(repo.channel_seq(channel_id).await.unwrap(), 0);
    let first = repo
        .create_sequenced(post(channel_id, None, "first"))
        .await
        .unwrap();
    assert_eq!(first.seq, Some(1));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn parents_other_than_channels_keep_no_log(pool: PgPool) {
    let user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'change-log', 'change-log@example.com', 'change-log')"#,
        user_id
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, 'change-log@example.com', $2)"#,
        USER,
        user_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ('change-log-doc', 'doc', $1, 'md')"#,
        USER
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgMessageRepository::new(pool.clone());
    let mut comment = post(Uuid::nil(), None, "comment");
    comment.parent = MessageParent::parse("document", "change-log-doc").unwrap();
    let written = repo.create_sequenced(comment).await.unwrap();
    assert_eq!(written.seq, None);
    let counters =
        sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM comms_channel_change_counters"#)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(counters, 0);
}

/// Sequence numbers follow commit order: whenever a reader sees the counter
/// at `n`, it also sees every change up to `n`. A reader that observed a
/// later number before an earlier one committed would skip the earlier change
/// for good.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_writers_never_expose_a_gap_to_a_reader(pool: PgPool) {
    const WRITERS: usize = 8;
    const WRITES_EACH: usize = 25;
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let root = repo
        .create_sequenced(post(channel_id, None, "root"))
        .await
        .unwrap()
        .value;

    let writers: Vec<_> = (0..WRITERS)
        .map(|writer| {
            let repo = repo.clone();
            tokio::spawn(async move {
                let parent = MessageParent::Channel(channel_id);
                let mut seqs = Vec::new();
                for write in 0..WRITES_EACH {
                    let body = format!("writer {writer} write {write}");
                    // Mix roots, replies under one shared root, and edits of
                    // it, so writers take different locks before the counter.
                    let written = match write % 3 {
                        0 => repo.create_sequenced(post(channel_id, None, &body)).await,
                        1 => {
                            repo.create_sequenced(post(channel_id, Some(root.id), &body))
                                .await
                        }
                        _ => repo.edit_sequenced(&parent, root.id, edit(&body)).await,
                    }
                    .unwrap();
                    seqs.push(written.seq.unwrap());
                }
                seqs
            })
        })
        .collect();

    let (stop, mut stopped) = tokio::sync::oneshot::channel::<()>();
    let reader = {
        let repo = repo.clone();
        tokio::spawn(async move {
            let mut seen = 0;
            let mut reads = 0;
            loop {
                let done = stopped.try_recv().is_ok();
                let log = repo
                    .channel_change_log(channel_id, seen, 10_000)
                    .await
                    .unwrap();
                let seqs: Vec<i64> = log.changes.iter().map(|change| change.seq).collect();
                let expected: Vec<i64> = (seen + 1..=log.counter).collect();
                assert_eq!(seqs, expected, "a read exposed a gap after {seen}");
                seen = log.counter;
                reads += 1;
                if done {
                    return (seen, reads);
                }
            }
        })
    };

    let mut all = Vec::new();
    for writer in writers {
        let seqs = writer.await.unwrap();
        // One writer's writes are sequential, so its numbers only grow.
        assert!(seqs.windows(2).all(|pair| pair[0] < pair[1]));
        all.extend(seqs);
    }
    stop.send(()).unwrap();
    let (seen, reads) = reader.await.unwrap();

    let total = (WRITERS * WRITES_EACH) as i64 + 1;
    all.sort_unstable();
    assert_eq!(all, (2..=total).collect::<Vec<_>>());
    assert_eq!(seen, total);
    assert!(reads > 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_writer_stops_waiting_for_a_stalled_writer(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    // A writer that took the channel's number and never commits.
    let mut stalled = pool.begin().await.unwrap();
    append(
        &mut stalled,
        channel_id,
        &[ChannelChangeOp::HistoryImported],
    )
    .await
    .unwrap();

    let waited = repo.create(post(channel_id, None, "waits")).await;
    assert!(matches!(waited, Err(MessageError::Repository(_))));

    // The failed write left nothing, and the bound does not outlive it.
    stalled.rollback().await.unwrap();
    let posted = repo
        .create_sequenced(post(channel_id, None, "posts"))
        .await
        .unwrap();
    assert_eq!(posted.seq, Some(1));
    let messages = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM comms_messages WHERE parent_entity_id = $1"#,
        channel_id.to_string(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(messages, 1);
    let mut connection = pool.acquire().await.unwrap();
    let bound = sqlx::query_scalar!(r#"SELECT current_setting('lock_timeout') AS "bound!""#)
        .fetch_one(&mut *connection)
        .await
        .unwrap();
    assert_eq!(bound, "0");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reader_is_caught_up_with_the_current_state_of_what_changed(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);

    let kept = repo.create(post(channel_id, None, "kept")).await.unwrap();
    let doomed = repo.create(post(channel_id, None, "doomed")).await.unwrap();
    let since = service.channel_seq(&viewer(channel_id)).await.unwrap();
    assert_eq!(since, 2);
    let current = service
        .channel_changes(viewer(channel_id), since)
        .await
        .unwrap();
    assert!(!current.reset && !current.has_more);
    assert_eq!(current.seq, since);
    assert!(current.entries.is_empty() && current.replies.is_empty());
    assert!(current.removed.is_empty());

    let reply = repo
        .create(post(channel_id, Some(kept.id), "reply"))
        .await
        .unwrap();
    let gone_reply = repo
        .create(post(channel_id, Some(kept.id), "gone"))
        .await
        .unwrap();
    repo.edit(&parent, reply.id, edit("reply, edited"))
        .await
        .unwrap();
    repo.delete(&parent, gone_reply.id).await.unwrap();
    repo.delete(&parent, doomed.id).await.unwrap();
    let added = repo.create(post(channel_id, None, "added")).await.unwrap();

    let changes = service
        .channel_changes(viewer(channel_id), since)
        .await
        .unwrap();
    assert!(!changes.reset && !changes.has_more);
    assert_eq!(changes.seq, 8);
    let mut roots: Vec<_> = changes
        .entries
        .iter()
        .map(|entry| match entry {
            MessageTimelineEntry::Message { message } => {
                (message.message.id, message.thread.reply_count)
            }
            other => panic!("unexpected entry {other:?}"),
        })
        .collect();
    roots.sort();
    let mut expected = vec![(kept.id, 1), (added.id, 0)];
    expected.sort();
    assert_eq!(roots, expected);
    assert_eq!(changes.replies.len(), 1);
    assert_eq!(changes.replies[0].id, reply.id);
    assert_eq!(changes.replies[0].content, "reply, edited");
    assert_eq!(
        sorted(changes.removed.clone()),
        sorted(vec![gone_reply.id, doomed.id])
    );

    // What the reader holds now matches a fresh read of the channel.
    let fresh = repo.timeline(&parent, Default::default()).await.unwrap();
    assert_eq!(
        sorted(fresh.items.iter().map(|item| item.message.id).collect()),
        sorted(vec![kept.id, added.id])
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_root_with_a_live_reply_stays_as_a_tombstone(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);
    let root = repo.create(post(channel_id, None, "root")).await.unwrap();
    repo.create(post(channel_id, Some(root.id), "reply"))
        .await
        .unwrap();
    let since = repo.channel_seq(channel_id).await.unwrap();
    repo.delete(&parent, root.id).await.unwrap();
    let changes = service
        .channel_changes(viewer(channel_id), since)
        .await
        .unwrap();
    assert!(changes.removed.is_empty());
    let [MessageTimelineEntry::Message { message }] = changes.entries.as_slice() else {
        panic!("expected the tombstone, got {:?}", changes.entries);
    };
    assert_eq!(message.message.id, root.id);
    assert!(message.message.deleted_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_long_backlog_is_read_in_pages(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);
    let total = MAX_CHANGE_ROWS + 20;
    let mut ids = Vec::new();
    for index in 0..total {
        ids.push(
            repo.create(post(channel_id, None, &format!("message {index}")))
                .await
                .unwrap()
                .id,
        );
    }
    let first = service
        .channel_changes(viewer(channel_id), 0)
        .await
        .unwrap();
    assert!(first.has_more);
    assert_eq!(first.seq, MAX_CHANGE_ROWS as i64);
    assert_eq!(first.entries.len(), MAX_CHANGE_ROWS);
    let second = service
        .channel_changes(viewer(channel_id), first.seq)
        .await
        .unwrap();
    assert!(!second.has_more);
    assert_eq!(second.seq, total as i64);
    let read = first
        .entries
        .iter()
        .chain(&second.entries)
        .map(|entry| entry.position().1)
        .collect();
    assert_eq!(sorted(read), sorted(ids));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_missing_channel_has_no_changes_to_read(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    // A deleted channel takes its counter with it.
    let deleted = channel(&pool).await;
    repo.create(post(deleted, None, "gone")).await.unwrap();
    sqlx::query!("DELETE FROM comms_channels WHERE id = $1", deleted)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(repo.channel_seq(deleted).await.unwrap(), 0);
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);
    assert!(matches!(
        service.channel_changes(viewer(Uuid::now_v7()), 0).await,
        Err(MessageError::NotFound)
    ));
    assert!(service.channel_changes(viewer(channel_id), 0).await.is_ok());
}

fn historical(thread_id: Option<Uuid>, import_order: i64) -> HistoricalMessage {
    // Whole seconds: imported timestamps carry at most microseconds.
    let created_at =
        chrono::DateTime::from_timestamp(Utc::now().timestamp(), 0).unwrap() - Duration::days(400);
    HistoricalMessage {
        id: macro_uuid::generate_uuid_v7(),
        thread_id,
        sender: USER.try_into().unwrap(),
        imported_author: None,
        content: "Historical content".into(),
        created_at,
        updated_at: created_at,
        edited_at: None,
        import_metadata: serde_json::json!({"slack_import_job": Uuid::nil(), "body_version": 1}),
        import_order,
        reactions: vec![],
        mentions: vec![],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn imported_history_makes_every_reader_start_over(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);
    repo.create(post(channel_id, None, "live")).await.unwrap();
    let root = historical(None, 0);
    let reply = historical(Some(root.id), 1);
    repo.insert_historical(&HistoricalBatch {
        channel_id,
        messages: vec![root.clone(), reply.clone()],
    })
    .await
    .unwrap();
    // One entry for the batch, however many messages it held.
    let log = repo
        .channel_change_log(channel_id, 1, MAX_CHANGE_ROWS)
        .await
        .unwrap();
    assert_eq!(
        log.changes,
        [ChannelChange {
            seq: 2,
            op: ChannelChangeOp::HistoryImported
        }]
    );
    let changes = service
        .channel_changes(viewer(channel_id), 1)
        .await
        .unwrap();
    assert!(changes.reset);
    assert_eq!(changes.seq, 2);
    // A reader that started over is current again.
    let current = service
        .channel_changes(viewer(channel_id), 2)
        .await
        .unwrap();
    assert!(!current.reset);

    // A reconciled body is an ordinary change to that message.
    let mut tx = pool.begin().await.unwrap();
    let patched = PgMessageRepository::patch_historical_body_in(
        &mut tx,
        &HistoricalBodyPatch {
            message_id: reply.id,
            channel_id,
            job_id: Uuid::nil(),
            importer_version: 1,
            expected_body: "Historical content".into(),
            body: "Reconciled content".into(),
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    assert!(patched);
    let changes = service
        .channel_changes(viewer(channel_id), 2)
        .await
        .unwrap();
    assert_eq!(changes.seq, 3);
    assert_eq!(changes.replies.len(), 1);
    assert_eq!(changes.replies[0].content, "Reconciled content");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retention_removes_old_rows_and_readers_behind_them_start_over(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher);
    for index in 0..4 {
        repo.create(post(channel_id, None, &format!("message {index}")))
            .await
            .unwrap();
    }
    sqlx::query!(
        "UPDATE comms_channel_change_log SET created_at = now() - interval '31 days'
         WHERE channel_id = $1 AND seq <= 2",
        channel_id,
    )
    .execute(&pool)
    .await
    .unwrap();
    let retention = ChannelChangeLogRetention::new(repo.clone());
    assert_eq!(retention.run_once(Utc::now()).await.unwrap(), 2);
    let log = repo
        .channel_change_log(channel_id, 2, MAX_CHANGE_ROWS)
        .await
        .unwrap();
    assert_eq!((log.counter, log.changes.len()), (4, 2));
    let pruned = repo
        .channel_change_log(channel_id, 1, MAX_CHANGE_ROWS)
        .await
        .unwrap();
    assert_eq!((pruned.counter, pruned.changes.len()), (4, 0));

    let behind = service
        .channel_changes(viewer(channel_id), 1)
        .await
        .unwrap();
    assert!(behind.reset);
    let caught_up = service
        .channel_changes(viewer(channel_id), 2)
        .await
        .unwrap();
    assert!(!caught_up.reset);
    assert_eq!(caught_up.entries.len(), 2);

    // Once every row is gone only a reader at the counter is current.
    sqlx::query!("UPDATE comms_channel_change_log SET created_at = now() - interval '31 days'")
        .execute(&pool)
        .await
        .unwrap();
    retention.run_once(Utc::now()).await.unwrap();
    let behind = service
        .channel_changes(viewer(channel_id), 3)
        .await
        .unwrap();
    assert!(behind.reset);
    let current = service
        .channel_changes(viewer(channel_id), 4)
        .await
        .unwrap();
    assert!(!current.reset);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn timeline_activity_joins_the_channel_sequence(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    repo.create(post(channel_id, None, "message"))
        .await
        .unwrap();
    let (first, second) = (Uuid::now_v7(), Uuid::now_v7());
    let seq = repo
        .record_activities(channel_id, &[first, second])
        .await
        .unwrap();
    assert_eq!(seq, Some(3));
    // A fact about a deleted channel is dropped, not retried forever.
    assert_eq!(
        repo.record_activities(Uuid::now_v7(), &[first])
            .await
            .unwrap(),
        None
    );
    let log = repo
        .channel_change_log(channel_id, 1, MAX_CHANGE_ROWS)
        .await
        .unwrap();
    assert_eq!(
        log.changes,
        [
            ChannelChange {
                seq: 2,
                op: ChannelChangeOp::Activity(first)
            },
            ChannelChange {
                seq: 3,
                op: ChannelChangeOp::Activity(second)
            },
        ]
    );
}

/// Returns the facts it holds for the ids asked.
struct Facts(Vec<activity::domain::timeline::TimelineActivity>);

type FactsRead<'a> = std::pin::Pin<
    Box<
        dyn Future<
                Output = Result<
                    Vec<activity::domain::timeline::TimelineActivity>,
                    activity::domain::timeline::TimelineReadError,
                >,
            > + Send
            + 'a,
    >,
>;

impl activity::domain::timeline::ActivityTimeline for Facts {
    fn read<'a>(&'a self, _: activity::domain::timeline::ActivityTimelineQuery) -> FactsRead<'a> {
        Box::pin(async { Ok(Vec::new()) })
    }

    fn read_by_ids<'a>(
        &'a self,
        lookup: activity::domain::timeline::ActivityTimelineLookup,
    ) -> FactsRead<'a> {
        Box::pin(async move {
            Ok(self
                .0
                .iter()
                .filter(|fact| lookup.ids.contains(&fact.id))
                .cloned()
                .collect())
        })
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reader_is_caught_up_with_timeline_facts(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let fact = activity::domain::timeline::TimelineActivity {
        id: Uuid::now_v7(),
        actor_id: USER.into(),
        occurred_at: Utc::now(),
        action: "renamed".into(),
        payload: None,
    };
    let service = MessageService::new(repo.clone(), NoMessageEventPublisher)
        .with_activity(Facts(vec![fact.clone()]));
    // Logged twice, as a replayed source batch would.
    repo.record_activities(channel_id, &[fact.id])
        .await
        .unwrap();
    repo.record_activities(channel_id, &[fact.id])
        .await
        .unwrap();
    let changes = service
        .channel_changes(viewer(channel_id), 0)
        .await
        .unwrap();
    assert_eq!(changes.seq, 2);
    assert_eq!(
        changes
            .activities
            .iter()
            .map(|fact| fact.id)
            .collect::<Vec<_>>(),
        [fact.id]
    );
    assert!(changes.entries.is_empty() && changes.removed.is_empty());
}
