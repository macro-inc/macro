use chrono::{DateTime, Duration, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

use super::*;
use crate::domain::{
    historical::{
        HistoricalReaction, HistoricalUserMention, MAX_HISTORICAL_BATCH_BYTES,
        MAX_HISTORICAL_MESSAGE_BYTES, MAX_HISTORICAL_MESSAGES,
    },
    models::MessageParent,
    ports::MessageRepository,
};

const USER: &str = "macro|historical@example.com";

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn read_targets_validate_live_roots_and_preserve_orphan_structure(pool: PgPool) {
    use crate::domain::ports::HistoricalMessageReader;
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let root = message(None, 0);
    let reply = message(Some(root.id), 1);
    let mut orphan = message(None, 2);
    orphan.import_metadata = serde_json::json!({"orphaned_thread_ts": "1.000001"});
    repo.insert_historical(&HistoricalBatch {
        channel_id,
        messages: vec![root.clone(), reply.clone(), orphan.clone()],
    })
    .await
    .unwrap();
    let ids = [root.id, reply.id, orphan.id, Uuid::now_v7()];
    let found = repo.lookup_historical_targets(&ids).await.unwrap();
    assert_eq!(found.len(), 3);
    assert!(found.iter().all(|m| m.channel_id == channel_id));
    assert!(
        found
            .iter()
            .any(|m| m.message_id == reply.id && m.root_id == root.id)
    );
    assert!(
        found
            .iter()
            .any(|m| m.message_id == orphan.id && m.root_id == orphan.id)
    );
    sqlx::query!(
        "UPDATE comms_messages SET deleted_at = now() WHERE id = $1",
        root.id
    )
    .execute(&pool)
    .await
    .unwrap();
    let found = repo.lookup_historical_targets(&ids).await.unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].message_id, orphan.id);
    sqlx::query!(
        "UPDATE comms_message_threads SET deleted_at = now() WHERE root_id = $1",
        orphan.id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.lookup_historical_targets(&ids)
            .await
            .unwrap()
            .is_empty()
    );
}

fn historical_time() -> DateTime<Utc> {
    DateTime::from_timestamp(1_600_000_000, 123_456_000).unwrap()
}

fn message(thread_id: Option<Uuid>, import_order: i64) -> HistoricalMessage {
    HistoricalMessage {
        id: macro_uuid::generate_uuid_v7(),
        thread_id,
        sender: USER.try_into().unwrap(),
        imported_author: None,
        content: "Historical content".into(),
        created_at: historical_time(),
        updated_at: historical_time() + Duration::seconds(1),
        edited_at: Some(historical_time() + Duration::seconds(1)),
        import_metadata: serde_json::json!({"source": "slack", "ts": "1600000000.123456"}),
        import_order,
        reactions: vec![],
        mentions: vec![],
    }
}

async fn channel(pool: &PgPool) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'History', 'private', $2)",
        id, USER,
    ).execute(pool).await.unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn roots_replies_attribution_and_order_across_batches(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let parent = MessageParent::Channel(channel_id);
    let repo = PgMessageRepository::new(pool.clone());
    let mut root = message(None, 0);
    root.sender = channel_sender::ChannelSender::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID);
    root.imported_author = Some("Archive Author".into());
    let later = message(Some(root.id), 20);
    // Replies may occur before their root in the input vector.
    repo.insert_historical(&HistoricalBatch {
        channel_id,
        messages: vec![later.clone(), root.clone()],
    })
    .await
    .unwrap();
    let earlier = message(Some(root.id), 10);
    repo.insert_historical(&HistoricalBatch {
        channel_id,
        messages: vec![earlier.clone()],
    })
    .await
    .unwrap();

    let hydrated = repo.get(&parent, root.id).await.unwrap().unwrap();
    assert_eq!(hydrated.imported_author.unwrap().name, "Archive Author");
    assert_eq!(hydrated.sender_id, root.sender);
    assert!(hydrated.bot_profile.is_some());
    assert_eq!(hydrated.created_at, root.created_at);
    assert_eq!(hydrated.updated_at, root.updated_at);
    assert_eq!(hydrated.edited_at, root.edited_at);
    let thread = repo.thread(&parent, root.id).await.unwrap().unwrap();
    assert_eq!(thread.created_at, root.created_at);
    assert_eq!(thread.updated_at, root.updated_at);
    let replies = repo.replies(&parent, root.id).await.unwrap();
    assert_eq!(
        replies.iter().map(|reply| reply.id).collect::<Vec<_>>(),
        vec![earlier.id, later.id]
    );
    let stored = sqlx::query!(
        "SELECT channel_id, parent_entity_type, parent_entity_id, import_metadata, import_order FROM comms_messages WHERE id = $1",
        root.id,
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(stored.channel_id, Some(channel_id));
    assert_eq!(stored.parent_entity_type, "channel");
    assert_eq!(stored.parent_entity_id, channel_id.to_string());
    assert_eq!(stored.import_metadata, Some(root.import_metadata));
    assert_eq!(stored.import_order, Some(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reactions_mentions_are_unique_and_have_no_live_effects(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let before = sqlx::query!(
        "SELECT updated_at FROM comms_channels WHERE id = $1",
        channel_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let repo = PgMessageRepository::new(pool.clone());
    let mut root = message(None, 0);
    let reaction = HistoricalReaction {
        user_id: USER.try_into().unwrap(),
        emoji: "\u{1f44d}".into(),
        created_at: historical_time(),
    };
    root.reactions = vec![reaction.clone(), reaction];
    root.mentions = (0..2)
        .map(|_| HistoricalUserMention {
            id: macro_uuid::generate_uuid_v7(),
            user_id: USER.try_into().unwrap(),
        })
        .collect();
    repo.insert_historical(&HistoricalBatch {
        channel_id,
        messages: vec![root.clone()],
    })
    .await
    .unwrap();
    let hydrated = repo
        .get(&MessageParent::Channel(channel_id), root.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(hydrated.reactions.len(), 1);
    assert_eq!(hydrated.reactions[0].users, vec![USER]);
    assert_eq!(hydrated.mentions.len(), 1);
    assert_eq!(hydrated.mentions[0].entity_type, "user");
    let reaction = sqlx::query!(
        "SELECT created_at FROM comms_reactions WHERE message_id = $1",
        root.id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(reaction.created_at, historical_time());
    let mention = sqlx::query!(
        "SELECT created_at, user_id FROM comms_entity_mentions WHERE source_entity_type = 'message' AND source_entity_id = $1",
        root.id.to_string(),
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(mention.created_at, historical_time());
    assert_eq!(mention.user_id.as_deref(), Some(USER));
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM comms_activity")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM comms_channel_participants")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM comms_attachments")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    let after = sqlx::query!(
        "SELECT updated_at FROM comms_channels WHERE id = $1",
        channel_id
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(before.updated_at, after.updated_at);
    // This adapter has no event publisher/effect capability. The historical port
    // is implemented directly, never through MessageCommands or live services.
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rejects_foreign_missing_reply_and_deleted_roots(pool: PgPool) {
    let first_channel = channel(&pool).await;
    let second_channel = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let root = message(None, 0);
    let reply = message(Some(root.id), 1);
    repo.insert_historical(&HistoricalBatch {
        channel_id: first_channel,
        messages: vec![root.clone(), reply.clone()],
    })
    .await
    .unwrap();
    for (channel_id, root_id) in [
        (second_channel, root.id),
        (first_channel, reply.id),
        (first_channel, macro_uuid::generate_uuid_v7()),
    ] {
        let new_root = message(None, 2);
        let result = repo
            .insert_historical(&HistoricalBatch {
                channel_id,
                messages: vec![new_root.clone(), message(Some(root_id), 3)],
            })
            .await;
        assert!(matches!(result, Err(MessageError::Invalid(_))));
        assert!(
            repo.get(&MessageParent::Channel(channel_id), new_root.id)
                .await
                .unwrap()
                .is_none()
        );
    }
    repo.delete_thread(&MessageParent::Channel(first_channel), root.id)
        .await
        .unwrap();
    assert!(matches!(
        repo.insert_historical(&HistoricalBatch {
            channel_id: first_channel,
            messages: vec![message(Some(root.id), 4)],
        })
        .await,
        Err(MessageError::Invalid(_))
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reaction_failure_rolls_back_savepoint_and_outer_transaction_stays_usable(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let mut root = message(None, 0);
    root.reactions.push(HistoricalReaction {
        user_id: USER.try_into().unwrap(),
        // PostgreSQL rejects NUL in text during the reaction statement, after
        // messages and their root-thread rows have already been inserted.
        emoji: "\0".into(),
        created_at: historical_time(),
    });
    let mut tx = pool.begin().await.unwrap();
    assert!(
        PgMessageRepository::insert_historical_in(
            &mut tx,
            &HistoricalBatch {
                channel_id,
                messages: vec![root.clone()],
            }
        )
        .await
        .is_err()
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM comms_messages")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM comms_message_threads")
            .fetch_one(&mut *tx)
            .await
            .unwrap(),
        Some(0)
    );
    root.reactions.clear();
    PgMessageRepository::insert_historical_in(
        &mut tx,
        &HistoricalBatch {
            channel_id,
            messages: vec![root.clone()],
        },
    )
    .await
    .unwrap();
    // Successful helper calls still do not commit the caller's transaction.
    tx.rollback().await.unwrap();
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM comms_messages")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM comms_reactions")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn existing_id_is_a_conflict_without_partial_writes_or_overwrite(pool: PgPool) {
    let channel_id = channel(&pool).await;
    let repo = PgMessageRepository::new(pool.clone());
    let mut original = message(None, 0);
    original.mentions.push(HistoricalUserMention {
        id: macro_uuid::generate_uuid_v7(),
        user_id: USER.try_into().unwrap(),
    });
    repo.insert_historical(&HistoricalBatch {
        channel_id,
        messages: vec![original.clone()],
    })
    .await
    .unwrap();
    original.content = "Replacement must not win".into();
    let new_root = message(None, 1);
    assert!(matches!(
        repo.insert_historical(&HistoricalBatch {
            channel_id,
            messages: vec![new_root.clone(), original.clone()],
        })
        .await,
        Err(MessageError::Conflict)
    ));
    let parent = MessageParent::Channel(channel_id);
    assert!(repo.get(&parent, new_root.id).await.unwrap().is_none());
    assert_eq!(
        repo.get(&parent, original.id)
            .await
            .unwrap()
            .unwrap()
            .content,
        "Historical content"
    );
    let mut conflicting_mention = new_root;
    conflicting_mention.mentions = original.mentions;
    assert!(matches!(
        repo.insert_historical(&HistoricalBatch {
            channel_id,
            messages: vec![conflicting_mention.clone()],
        })
        .await,
        Err(MessageError::Invalid(
            "historical mention id already exists"
        ))
    ));
    assert!(
        repo.get(&parent, conflicting_mention.id)
            .await
            .unwrap()
            .is_none()
    );
}

#[test]
fn validates_timestamps_ids_counts_and_byte_limits() {
    let valid = HistoricalBatch {
        channel_id: macro_uuid::generate_uuid_v7(),
        messages: vec![message(None, 0)],
    };
    valid.validate().unwrap();
    let invalid_changes: Vec<fn(&mut HistoricalMessage)> = vec![
        |m| m.id = Uuid::nil(),
        |m| m.id = "00000000-0000-7000-0000-000000000000".parse().unwrap(),
        |m| m.id = "00000000-0000-4000-8000-000000000000".parse().unwrap(),
        |m| {
            m.mentions.push(HistoricalUserMention {
                id: m.id,
                user_id: USER.try_into().unwrap(),
            })
        },
        |m| m.thread_id = Some(m.id),
        |m| m.import_order = -1,
        |m| m.content = " \n".into(),
        |m| m.created_at = DateTime::from_timestamp(-1, 0).unwrap(),
        |m| m.updated_at = DateTime::from_timestamp(253_402_300_800, 0).unwrap(),
        |m| m.created_at += Duration::nanoseconds(1),
        |m| m.updated_at = m.created_at - Duration::seconds(1),
        |m| m.edited_at = Some(m.updated_at + Duration::seconds(1)),
        |m| m.content = "a".repeat(MAX_HISTORICAL_MESSAGE_BYTES),
        |m| {
            m.import_metadata =
                serde_json::json!({"large": "a".repeat(MAX_HISTORICAL_MESSAGE_BYTES)})
        },
        |m| {
            m.reactions.push(HistoricalReaction {
                user_id: USER.try_into().unwrap(),
                emoji: "a".repeat(33),
                created_at: historical_time(),
            })
        },
    ];
    for change in invalid_changes {
        let mut invalid = valid.clone();
        change(&mut invalid.messages[0]);
        assert!(invalid.validate().is_err());
    }
    let mut oversized = valid.clone();
    oversized.messages = (0..=MAX_HISTORICAL_MESSAGES)
        .map(|_| message(None, 0))
        .collect();
    assert!(oversized.validate().is_err());
    oversized.messages.pop();
    oversized.validate().unwrap();
    oversized.messages = (0..5)
        .map(|_| {
            let mut m = message(None, 0);
            m.content = "a".repeat(MAX_HISTORICAL_BATCH_BYTES / 5);
            m
        })
        .collect();
    assert!(oversized.validate().is_err());
    let mut duplicate = valid.clone();
    duplicate.messages.push(duplicate.messages[0].clone());
    assert!(duplicate.validate().is_err());
    for seconds in [0, 253_402_300_799] {
        let mut boundary = valid.clone();
        let message = &mut boundary.messages[0];
        message.created_at = DateTime::from_timestamp(seconds, 999_999_000).unwrap();
        message.updated_at = message.created_at;
        message.edited_at = None;
        boundary.validate().unwrap();
    }
}
