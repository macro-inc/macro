use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_log_prunes_bounded_prefixes_without_reusing_the_counter(pool: PgPool) {
    let channel = Uuid::from_u128(20);
    let now = Utc::now();
    sqlx::query!(
        "INSERT INTO channel_change_counters(channel_id, seq) VALUES ($1, 8)",
        channel
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO channel_change_log(channel_id, seq, kind, message_id, created_at)
         SELECT $1, n, 1, $2, $3::timestamptz + n * interval '1 second' FROM generate_series(1, 8) n",
        channel, Uuid::from_u128(1), now - chrono::Duration::days(31),
    ).execute(&pool).await.unwrap();
    let repo = PgMessageRepository::new(pool);
    assert_eq!(repo.prune_channel_change_log(now, 3).await.unwrap(), 3);
    let log = repo.read_channel_change_log(channel, 0).await.unwrap();
    assert_eq!((log.seq, log.floor), (8, 3));
    assert_eq!(
        log.changes
            .iter()
            .map(|change| change.seq)
            .collect::<Vec<_>>(),
        vec![4, 5, 6, 7, 8]
    );
    assert_eq!(repo.prune_channel_change_log(now, 10).await.unwrap(), 5);
    let empty = repo.read_channel_change_log(channel, 8).await.unwrap();
    assert_eq!((empty.seq, empty.floor), (8, 8));
    assert!(empty.changes.is_empty());
    assert_eq!(repo.read_channel_seq(channel).await.unwrap(), 8);
    let unseen = repo
        .read_channel_change_log(Uuid::from_u128(21), 0)
        .await
        .unwrap();
    assert_eq!(unseen, ChannelChangeLog::default());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_log_detects_reset_after_page_and_bounds_excessive_lag(pool: PgPool) {
    let channel = Uuid::from_u128(20);
    sqlx::query!(
        "INSERT INTO channel_change_counters(channel_id, seq) VALUES ($1, 1001)",
        channel
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO channel_change_log(channel_id, seq, kind, message_id)
         SELECT $1, n, CASE WHEN n = 550 THEN 3 ELSE 1 END,
             CASE WHEN n = 550 THEN NULL::uuid ELSE $2 END
         FROM generate_series(1, 1001) n",
        channel,
        Uuid::from_u128(1),
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgMessageRepository::new(pool);
    let behind = repo.read_channel_change_log(channel, 0).await.unwrap();
    assert_eq!(behind.seq, 1001);
    assert!(behind.changes.is_empty());
    let log = repo.read_channel_change_log(channel, 1).await.unwrap();
    assert_eq!(log.changes.len(), 1000);
    assert_eq!(log.changes[548].kind, ChannelChangeKind::Reset);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_change_hydration_keeps_tombstones_roots_and_parent_isolation(pool: PgPool) {
    let channel = Uuid::from_u128(20);
    let other = Uuid::from_u128(21);
    sqlx::query!(
        "INSERT INTO comms_channels(id, channel_type, owner_id)
         SELECT id, 'private', 'macro|test@example.com' FROM unnest($1::uuid[]) id",
        &[channel, other],
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgMessageRepository::new(pool);
    let root = repo.create(command(channel, None)).await.unwrap().0;
    let reply = repo
        .create(command(channel, Some(root.id)))
        .await
        .unwrap()
        .0;
    let other_root = repo.create(command(other, None)).await.unwrap().0;
    repo.delete(&root.parent, root.id).await.unwrap();
    repo.delete(&reply.parent, reply.id).await.unwrap();
    let changes = repo
        .read_channel_message_changes(channel, &[reply.id, other_root.id, Uuid::from_u128(99)])
        .await
        .unwrap();
    assert_eq!(changes.len(), 2);
    let ChannelMessageChange::Root { message, .. } = &changes[0] else {
        panic!("expected root")
    };
    assert_eq!(message.message.id, root.id);
    assert!(message.message.deleted_at.is_some());
    assert_eq!(message.thread.reply_count, 0);
    let ChannelMessageChange::Reply { message } = &changes[1] else {
        panic!("expected reply")
    };
    assert_eq!(message.id, reply.id);
    assert!(message.deleted_at.is_some());
}

fn command(channel: Uuid, thread_id: Option<Uuid>) -> CreateMessage {
    CreateMessage {
        kind: MessageKind::Message,
        guest_name: None,
        canonical_root_id: None,
        parent: MessageParent::Channel(channel),
        actor: "macro|test@example.com".to_owned().try_into().unwrap(),
        triggered_via: None,
        triggered_by: None,
        input: PostMessage {
            id: None,
            attribution: Default::default(),
            notification_policy: Default::default(),
            content: "stored message".to_owned(),
            thread_id,
            anchor: None,
            mentions: Vec::new(),
            attachments: Vec::new(),
            nonce: None,
        },
    }
}
