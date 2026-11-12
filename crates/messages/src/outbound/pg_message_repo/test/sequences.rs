use super::*;
use std::sync::Arc;
use tokio::{
    sync::{Barrier, Semaphore},
    task::JoinSet,
};

pub(super) async fn channel_fixture(pool: &PgPool) -> Uuid {
    let channel_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels(id, channel_type, owner_id) VALUES ($1, 'private', $2)",
        channel_id,
        USER,
    )
    .execute(pool)
    .await
    .unwrap();
    channel_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_writers_publish_gap_free_committed_prefix(pool: PgPool) {
    const WRITERS: usize = 48;
    setup(&pool).await;
    let channel_id = channel_fixture(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let ids: Vec<_> = (0..WRITERS)
        .map(|_| macro_uuid::generate_uuid_v7())
        .collect();
    // Prepare edit/reaction targets using the exact pre-sequence writer. Only
    // the concurrent operations below belong to the sequence being asserted.
    for (_, id) in ids.iter().enumerate().filter(|(index, _)| index % 3 != 0) {
        let mut input = command("message-doc-a", None, "before");
        input.parent = parent.clone();
        input.input.id = Some(*id);
        repo.create_before_sequences(input).await.unwrap();
    }

    // Reserve the reader before writers queue for connections. Gate the second
    // wave until a prefix has been observed, making that intermediate read
    // deterministic instead of relying on scheduler timing or sleeps.
    let mut reader = pool.acquire().await.unwrap();
    let second_wave = Arc::new(Semaphore::new(0));
    let start = Arc::new(Barrier::new(WRITERS + 1));
    let mut writers = JoinSet::new();
    for (index, id) in ids.iter().copied().enumerate() {
        let repo = repo.clone();
        let parent = parent.clone();
        let start = start.clone();
        let second_wave = second_wave.clone();
        writers.spawn(async move {
            start.wait().await;
            let _permit = if index >= WRITERS / 2 {
                Some(second_wave.acquire().await.unwrap())
            } else {
                None
            };
            let seq = match index % 3 {
                0 => {
                    let mut input = command("message-doc-a", None, "created");
                    input.parent = parent;
                    input.input.id = Some(id);
                    repo.create(input).await.unwrap().1
                }
                1 => {
                    repo.edit(
                        &parent,
                        id,
                        EditMessage {
                            notification_policy: Default::default(),
                            content: "edited".into(),
                            mentions: vec![],
                            attachments: None,
                            nonce: None,
                        },
                    )
                    .await
                    .unwrap()
                    .1
                }
                _ => repo.react(&parent, id, USER, "👍", true).await.unwrap().seq,
            };
            seq.expect("each changed channel message has a sequence")
        });
    }
    start.wait().await;
    let mut returned = Vec::new();
    while let Some(completed) = writers.join_next().await {
        let completed_seq = completed.unwrap();
        returned.push(completed_seq);
        // Counter, log and message data come from one statement snapshot. No
        // completion/notification ordering is assumed: a visible K must expose
        // every prior log row and its corresponding committed mutation.
        let visible = sqlx::query!(
            r#"SELECT c.seq AS counter_seq, l.seq, l.message_id,
                      m.content AS "content?", m.edited_at,
                      EXISTS (SELECT 1 FROM comms_reactions r
                              WHERE r.message_id = l.message_id
                                AND r.user_id = $2 AND r.emoji = '👍') AS "reacted!"
               FROM channel_change_counters c
               JOIN channel_change_log l ON l.channel_id = c.channel_id
               LEFT JOIN comms_messages m ON m.id = l.message_id
               WHERE c.channel_id = $1 ORDER BY l.seq"#,
            channel_id,
            USER,
        )
        .fetch_all(&mut *reader)
        .await
        .unwrap();
        let counter = visible.last().unwrap().counter_seq;
        assert!(counter >= completed_seq);
        if returned.len() == 1 {
            assert!(counter <= WRITERS as i64 / 2);
            second_wave.add_permits(WRITERS / 2);
        }
        assert_eq!(visible.len() as i64, counter);
        for (offset, row) in visible.iter().enumerate() {
            assert_eq!(row.seq, offset as i64 + 1);
            let index = ids
                .iter()
                .position(|id| Some(*id) == row.message_id)
                .unwrap();
            match index % 3 {
                0 => assert_eq!(row.content.as_deref(), Some("created")),
                1 => {
                    assert_eq!(row.content.as_deref(), Some("edited"));
                    assert!(row.edited_at.is_some());
                }
                _ => {
                    assert_eq!(row.content.as_deref(), Some("before"));
                    assert!(row.reacted);
                }
            }
        }
    }
    returned.sort_unstable();
    assert_eq!(returned, (1..=WRITERS as i64).collect::<Vec<_>>());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_changes_sequence_mutations_but_not_reaction_noops(pool: PgPool) {
    setup(&pool).await;
    let channel_id = channel_fixture(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let mut input = command("message-doc-a", None, "root");
    input.parent = parent.clone();
    let (root, seq) = repo.create(input.clone()).await.unwrap();
    assert_eq!(seq, Some(1));
    input.input.thread_id = Some(root.id);
    let (reply, seq) = repo.create(input).await.unwrap();
    assert_eq!(seq, Some(2));
    let (_, seq) = repo
        .edit(
            &parent,
            reply.id,
            EditMessage {
                notification_policy: Default::default(),
                content: "edited".into(),
                mentions: vec![],
                attachments: None,
                nonce: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(seq, Some(3));
    assert_eq!(
        repo.react(&parent, reply.id, USER, "👍", true)
            .await
            .unwrap()
            .seq,
        Some(4)
    );
    let duplicate = repo
        .react(&parent, reply.id, USER, "👍", true)
        .await
        .unwrap();
    assert!(!duplicate.changed);
    assert_eq!(duplicate.seq, None);
    assert_eq!(
        repo.react(&parent, reply.id, USER, "👍", false)
            .await
            .unwrap()
            .seq,
        Some(5)
    );
    let absent = repo
        .react(&parent, reply.id, USER, "👍", false)
        .await
        .unwrap();
    assert!(!absent.changed);
    assert_eq!(absent.seq, None);
    let (_, seq) = repo
        .patch_thread(
            &parent,
            root.id,
            ThreadPatch {
                resolved: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(seq, Some(6));
    assert_eq!(repo.delete(&parent, reply.id).await.unwrap().1, Some(7));
    assert_eq!(
        repo.delete_thread(&parent, root.id).await.unwrap().1,
        Some(8)
    );
    let entries = sqlx::query!(
        "SELECT seq, kind, message_id, activity_id FROM channel_change_log WHERE channel_id = $1 ORDER BY seq",
        channel_id,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(entries.len(), 8);
    assert!(
        entries
            .iter()
            .all(|entry| entry.kind == 1 && entry.activity_id.is_none())
    );
    assert_eq!(entries.last().unwrap().message_id, Some(root.id));
    assert!(
        repo.get(&parent, root.id)
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some()
    );
    assert!(
        repo.get(&parent, reply.id)
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_reply_locks_its_deferred_fk_before_the_counter(pool: PgPool) {
    setup(&pool).await;
    let channel_id = channel_fixture(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let mut input = command("message-doc-a", None, "root");
    input.parent = parent.clone();
    let (root, seq) = repo.create(input).await.unwrap();
    assert_eq!(seq, Some(1));

    let reply_id = macro_uuid::generate_uuid_v7();
    let mut reply_tx = pool.begin().await.unwrap();
    assert!(
        PgMessageRepository::lock_channel_reply_root_in(&mut reply_tx, &parent, root.id)
            .await
            .unwrap()
    );
    sqlx::query!(
        r#"INSERT INTO comms_messages
               (id, parent_entity_type, parent_entity_id, thread_id, sender_id, content)
           VALUES ($1, 'channel', $2, $3, $4, 'reply')"#,
        reply_id,
        channel_id.to_string(),
        root.id,
        USER,
    )
    .execute(&mut *reply_tx)
    .await
    .unwrap();
    assert_eq!(
        PgMessageRepository::append_message_change_in(&mut reply_tx, &parent, reply_id)
            .await
            .unwrap(),
        Some(2),
    );

    // A thread writer may lock the thread row before trying the root. The reply
    // must already protect its deferred root FK while holding the counter, and
    // must not need that independently locked thread row to finish COMMIT.
    let mut thread_writer = pool.begin().await.unwrap();
    sqlx::query_scalar!(
        "SELECT root_id FROM comms_message_threads WHERE root_id = $1 FOR UPDATE NOWAIT",
        root.id,
    )
    .fetch_one(&mut *thread_writer)
    .await
    .unwrap();
    let mut root_probe = pool.begin().await.unwrap();
    let blocked = sqlx::query_scalar!(
        "SELECT id FROM comms_messages WHERE id = $1 FOR UPDATE NOWAIT",
        root.id,
    )
    .fetch_one(&mut *root_probe)
    .await
    .expect_err("the reply must already hold the root FK lock before taking the counter");
    assert_eq!(
        blocked.as_database_error().unwrap().code().as_deref(),
        Some("55P03"),
    );
    root_probe.rollback().await.unwrap();
    assert_eq!(
        channel_change_db_utils::current_seq(&pool, channel_id)
            .await
            .unwrap(),
        1
    );
    tokio::time::timeout(std::time::Duration::from_secs(5), reply_tx.commit())
        .await
        .expect("reply commit must not wait for a thread writer")
        .unwrap();
    thread_writer.rollback().await.unwrap();

    let (_, seq) = repo
        .edit(
            &parent,
            root.id,
            EditMessage {
                notification_policy: Default::default(),
                content: "edited after reply".into(),
                mentions: vec![],
                attachments: None,
                nonce: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(seq, Some(3));
    assert_eq!(
        repo.react(&parent, root.id, USER, "👍", true)
            .await
            .unwrap()
            .seq,
        Some(4),
    );
    assert_eq!(
        repo.patch_thread(
            &parent,
            root.id,
            ThreadPatch {
                resolved: Some(true),
                ..Default::default()
            },
        )
        .await
        .unwrap()
        .1,
        Some(5),
    );
    assert_eq!(
        repo.replies(&parent, root.id).await.unwrap()[0].id,
        reply_id
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_channel_replies_and_root_writers_finish_without_deadlocks(pool: PgPool) {
    const WRITERS: usize = 32;
    setup(&pool).await;
    let channel_id = channel_fixture(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let mut input = command("message-doc-a", None, "root");
    input.parent = parent.clone();
    let (root, seq) = repo.create(input).await.unwrap();
    assert_eq!(seq, Some(1));

    let barrier = Arc::new(Barrier::new(WRITERS + 1));
    let mut writers = JoinSet::new();
    for index in 0..WRITERS {
        let repo = repo.clone();
        let parent = parent.clone();
        let barrier = barrier.clone();
        let root_id = root.id;
        writers.spawn(async move {
            barrier.wait().await;
            let seq = if index % 2 == 0 {
                let mut input = command("message-doc-a", Some(root_id), "concurrent reply");
                input.parent = parent;
                repo.create(input).await.unwrap().1
            } else {
                match index % 6 {
                    1 => {
                        repo.edit(
                            &parent,
                            root_id,
                            EditMessage {
                                notification_policy: Default::default(),
                                content: format!("root edit {index}"),
                                mentions: vec![],
                                attachments: None,
                                nonce: None,
                            },
                        )
                        .await
                        .unwrap()
                        .1
                    }
                    3 => {
                        repo.react(&parent, root_id, USER, &format!("reaction-{index}"), true)
                            .await
                            .unwrap()
                            .seq
                    }
                    _ => {
                        repo.patch_thread(
                            &parent,
                            root_id,
                            ThreadPatch {
                                resolved: Some(index % 4 == 1),
                                ..Default::default()
                            },
                        )
                        .await
                        .unwrap()
                        .1
                    }
                }
            };
            seq.unwrap()
        });
    }
    barrier.wait().await;
    let mut sequences = tokio::time::timeout(std::time::Duration::from_secs(20), async {
        let mut sequences = Vec::with_capacity(WRITERS);
        while let Some(completed) = writers.join_next().await {
            sequences.push(completed.unwrap());
        }
        sequences
    })
    .await
    .expect("reply inserts and root mutations must not deadlock");
    sequences.sort_unstable();
    assert_eq!(sequences, (2..=WRITERS as i64 + 1).collect::<Vec<_>>());
    assert_eq!(
        repo.replies(&parent, root.id).await.unwrap().len(),
        WRITERS / 2
    );
    assert_eq!(
        channel_change_db_utils::current_seq(&pool, channel_id)
            .await
            .unwrap(),
        WRITERS as i64 + 1
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_counter_wait_timeout_rolls_back_the_entire_message(pool: PgPool) {
    setup(&pool).await;
    let channel_id = channel_fixture(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let mut input = command("message-doc-a", None, "committed root");
    input.parent = parent.clone();
    let (root, seq) = repo.create(input).await.unwrap();
    assert_eq!(seq, Some(1));

    // Hold only the counter, leaving the independent message rows free. Each
    // contender gets as far as its final append before PostgreSQL cancels it.
    let mut holder = pool.begin().await.unwrap();
    assert_eq!(
        PgMessageRepository::append_message_change_in(&mut holder, &parent, root.id)
            .await
            .unwrap(),
        Some(2)
    );
    for (lock_timeout, statement_timeout, expected_code, expected_message) in [
        ("75ms", "0", "55P03", "canceling statement due to lock timeout"),
        (
            "0",
            "75ms",
            "57014",
            "canceling statement due to statement timeout",
        ),
    ] {
        let options = pool.connect_options().as_ref().clone().options([
            ("lock_timeout", lock_timeout),
            ("statement_timeout", statement_timeout),
        ]);
        let timed_pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let timed_repo = PgMessageRepository::new(timed_pool.clone());
        let failed_id = macro_uuid::generate_uuid_v7();
        let mut input = command("message-doc-a", None, "must roll back");
        input.parent = parent.clone();
        input.input.id = Some(failed_id);
        let failure = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            timed_repo.create(input),
        )
        .await
        .expect("configured PostgreSQL timeout must stop the counter waiter")
        .unwrap_err();
        let MessageError::Repository(report) = failure else {
            panic!("counter timeout must propagate as a repository failure");
        };
        let error = report.downcast_current_context::<sqlx::Error>().unwrap();
        let database = error.as_database_error().unwrap();
        assert_eq!(database.code().as_deref(), Some(expected_code));
        assert_eq!(database.message(), expected_message);

        // Acquiring the sole connection again also waits for SQLx's rollback.
        assert!(timed_repo.get(&parent, failed_id).await.unwrap().is_none());
        assert_eq!(
            channel_change_db_utils::current_seq(&timed_pool, channel_id)
                .await
                .unwrap(),
            1
        );
        timed_pool.close().await;
    }
    holder.rollback().await.unwrap();
    let mut input = command("message-doc-a", None, "after cancelled waiters");
    input.parent = parent;
    assert_eq!(repo.create(input).await.unwrap().1, Some(2));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_counter_wait_without_timeouts_resumes_after_holder_rolls_back(pool: PgPool) {
    setup(&pool).await;
    let channel_id = channel_fixture(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let mut input = command("message-doc-a", None, "committed root");
    input.parent = parent.clone();
    let (root, _) = repo.create(input).await.unwrap();
    let mut holder = pool.begin().await.unwrap();
    PgMessageRepository::append_message_change_in(&mut holder, &parent, root.id)
        .await
        .unwrap();

    let options = pool
        .connect_options()
        .as_ref()
        .clone()
        .options([("lock_timeout", "0"), ("statement_timeout", "0")]);
    let waiting_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .unwrap();
    let waiting_repo = PgMessageRepository::new(waiting_pool.clone());
    let mut input = command("message-doc-a", None, "waiting for counter");
    input.parent = parent;
    let waiter = waiting_repo.create(input);
    tokio::pin!(waiter);
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(150), &mut waiter)
            .await
            .is_err(),
        "with no timeout the waiter stays pending while the holder is open"
    );
    holder.rollback().await.unwrap();
    assert_eq!(
        tokio::time::timeout(std::time::Duration::from_secs(5), waiter)
            .await
            .expect("waiter resumes when holder releases the counter")
            .unwrap()
            .1,
        Some(2)
    );
    waiting_pool.close().await;
}
