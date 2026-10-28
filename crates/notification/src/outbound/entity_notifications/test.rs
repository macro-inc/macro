use super::*;
use crate::domain::models::{Notification, SendNotificationRequestBuilder, TaggedContent};
use crate::outbound::repository::NotificationDbOps;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
struct Message {
    #[serde(rename = "messageId")]
    message_id: String,
}
impl Notification for Message {
    const TYPE_NAME: &'static str = "channel_message_send";
}
#[derive(Clone, Serialize, Deserialize)]
struct Call;
impl Notification for Call {
    const TYPE_NAME: &'static str = "call_started";
}
#[derive(Clone, Serialize, Deserialize)]
struct AccessRequested;
impl Notification for AccessRequested {
    const TYPE_NAME: &'static str = "channel_access_requested";
}

async fn insert<T: Notification + Serialize + Send + Sync>(
    pool: &PgPool,
    user: &MacroUserIdStr<'static>,
    entity: Entity<'static>,
    secondary: Option<Entity<'static>>,
    notification: T,
) -> Uuid {
    let id = Uuid::now_v7();
    pool.create_notification(
        SendNotificationRequestBuilder {
            notification_entity: entity,
            secondary_notification_entity: secondary,
            notification: TaggedContent::new(notification),
            sender_id: None,
            recipient_ids: HashSet::from([user.clone()]),
        },
        id,
        "test",
        None,
    )
    .await
    .unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn filters_before_limit_per_entity_and_preserves_full_reads(pool: PgPool) {
    let viewer = MacroUserIdStr::try_from_email("viewer@test.com").unwrap();
    let other = MacroUserIdStr::try_from_email("other@test.com").unwrap();
    let channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let second = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let read_channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let thread = EntityType::ChannelMessage.with_entity_string(Uuid::now_v7().to_string());
    let oldest = insert(
        &pool,
        &viewer,
        channel.clone(),
        Some(thread.clone()),
        Message {
            message_id: "root".into(),
        },
    )
    .await;
    let newest = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Message {
            message_id: "newest".into(),
        },
    )
    .await;
    let second_id = insert(
        &pool,
        &viewer,
        second.clone(),
        None,
        Message {
            message_id: "second".into(),
        },
    )
    .await;
    let seen = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Message {
            message_id: "seen".into(),
        },
    )
    .await;
    pool.mark_notifications_seen(&viewer, &[seen])
        .await
        .unwrap();
    let done = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Message {
            message_id: "done".into(),
        },
    )
    .await;
    pool.mark_notifications_done(&viewer, &[done], true)
        .await
        .unwrap();
    let deleted = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Message {
            message_id: "deleted".into(),
        },
    )
    .await;
    pool.delete_user_notification(viewer.clone(), deleted)
        .await
        .unwrap();
    insert(
        &pool,
        &other,
        channel.clone(),
        None,
        Message {
            message_id: "other-viewer".into(),
        },
    )
    .await;
    insert(&pool, &viewer, channel.clone(), None, Call).await;
    let query = EntityNotificationQuery {
        states: vec![NotificationState::Unseen],
        event_types: vec![Message::TYPE_NAME.into()],
        limit: Some(1),
        ..Default::default()
    };
    let entities = vec![
        channel.clone(),
        second.clone(),
        read_channel.clone(),
        thread.clone(),
        channel.clone(),
    ];
    let result = get_filtered_entity_notifications(&pool, viewer.clone(), entities, query.clone())
        .await
        .unwrap();
    assert_eq!(result[&channel].len(), 1);
    assert_eq!(result[&channel][0].notification_id, newest);
    assert_eq!(result[&second][0].notification_id, second_id);
    assert!(result[&read_channel].is_empty());
    assert_eq!(result[&thread][0].notification_id, oldest);
    assert_eq!(
        result[&thread][0].entity, channel,
        "secondary lookup preserves primary identity"
    );
    let full = pool
        .get_entity_notifications_batch(viewer.clone(), vec![channel.clone()], Default::default())
        .await
        .unwrap();
    assert_eq!(
        full[&channel].len(),
        4,
        "two unseen messages, one seen message, one call"
    );
    pool.mark_notifications_seen(&viewer, &[newest])
        .await
        .unwrap();
    let result = get_filtered_entity_notifications(
        &pool,
        viewer.clone(),
        vec![channel.clone()],
        query.clone(),
    )
    .await
    .unwrap();
    assert_eq!(
        result[&channel][0].notification_id, oldest,
        "revalidation finds the next unread"
    );
    pool.mark_notifications_seen(&viewer, &[oldest])
        .await
        .unwrap();
    let result =
        get_filtered_entity_notifications(&pool, viewer.clone(), vec![channel.clone()], query)
            .await
            .unwrap();
    assert!(result[&channel].is_empty());
    let empty = get_filtered_entity_notifications(
        &pool,
        viewer,
        vec![channel.clone()],
        EntityNotificationQuery {
            states: vec![],
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(empty[&channel].is_empty());
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Mention {
    message_id: String,
    thread_id: Option<String>,
}
impl Notification for Mention {
    const TYPE_NAME: &'static str = "channel_mention";
}

#[derive(Clone, Serialize, Deserialize)]
struct LegacyMention {
    message_id: String,
    thread_id: String,
}
impl Notification for LegacyMention {
    const TYPE_NAME: &'static str = "channel_mention";
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reaction {
    message_id: String,
}
impl Notification for Reaction {
    const TYPE_NAME: &'static str = "channel_message_reaction";
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn top_level_filter_finds_older_mentions_before_limiting(pool: PgPool) {
    let viewer = MacroUserIdStr::try_from_email("viewer@test.com").unwrap();
    let channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let root = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Mention {
            message_id: "root".into(),
            thread_id: None,
        },
    )
    .await;
    let reply = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Mention {
            message_id: "reply".into(),
            thread_id: Some("root".into()),
        },
    )
    .await;
    insert(&pool, &viewer, channel.clone(), None, Call).await;
    insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        LegacyMention {
            message_id: "legacy-reply".into(),
            thread_id: "root".into(),
        },
    )
    .await;
    insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Reaction {
            message_id: "root".into(),
        },
    )
    .await;
    let query = EntityNotificationQuery {
        states: vec![NotificationState::Unseen],
        top_level_messages_only: true,
        limit: Some(1),
        ..Default::default()
    };
    let result = get_filtered_entity_notifications(
        &pool,
        viewer.clone(),
        vec![channel.clone()],
        query.clone(),
    )
    .await
    .unwrap();
    assert_eq!(result[&channel].len(), 1);
    assert_eq!(result[&channel][0].notification_id, root);
    pool.mark_notifications_seen(&viewer, &[root])
        .await
        .unwrap();
    let result =
        get_filtered_entity_notifications(&pool, viewer.clone(), vec![channel.clone()], query)
            .await
            .unwrap();
    assert!(
        result[&channel].is_empty(),
        "reply mentions, reactions, and calls do not badge the channel"
    );
    let full =
        get_filtered_entity_notifications(&pool, viewer, vec![channel.clone()], Default::default())
            .await
            .unwrap();
    assert_eq!(
        full[&channel].len(),
        5,
        "full hydration keeps every notification"
    );
    assert!(
        full[&channel]
            .iter()
            .any(|row| row.notification_id == reply && row.state == NotificationState::Unseen)
    );
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Reply {
    message_id: String,
    thread_id: String,
}
impl Notification for Reply {
    const TYPE_NAME: &'static str = "channel_message_reply";
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_feed_scope_excludes_thread_roots_before_the_limit(pool: PgPool) {
    let viewer = MacroUserIdStr::try_from_email("viewer@test.com").unwrap();
    let channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let witness = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Message {
            message_id: "unthreaded".into(),
        },
    )
    .await;
    for root in ["replied", "thread-mentioned"] {
        insert(
            &pool,
            &viewer,
            channel.clone(),
            None,
            Message {
                message_id: root.into(),
            },
        )
        .await;
    }
    let seen_reply = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Reply {
            message_id: "reply".into(),
            thread_id: "replied".into(),
        },
    )
    .await;
    let seen_mention = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Mention {
            message_id: "mention-without-send".into(),
            thread_id: None,
        },
    )
    .await;
    let legacy_mention = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        LegacyMention {
            message_id: "legacy-reply".into(),
            thread_id: "thread-mentioned".into(),
        },
    )
    .await;
    pool.mark_notifications_seen(&viewer, &[seen_reply, seen_mention, legacy_mention])
        .await
        .unwrap();
    insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Reaction {
            message_id: "unthreaded".into(),
        },
    )
    .await;
    insert(&pool, &viewer, channel.clone(), None, Call).await;
    let query = EntityNotificationQuery {
        states: vec![NotificationState::Unseen],
        channel_feed_only: true,
        limit: Some(1),
        ..Default::default()
    };
    let read = || {
        get_filtered_entity_notifications(
            &pool,
            viewer.clone(),
            vec![channel.clone()],
            query.clone(),
        )
    };
    let rows = read().await.unwrap();
    assert_eq!(rows[&channel].len(), 1);
    assert_eq!(rows[&channel][0].notification_id, witness);
    pool.mark_notifications_seen(&viewer, &[witness])
        .await
        .unwrap();
    assert!(
        read().await.unwrap()[&channel].is_empty(),
        "unseen roots already assigned to threads cannot badge the channel feed"
    );

    // Completing the thread's last active reason releases its root to the feed.
    pool.mark_notifications_done(&viewer, &[seen_reply], true)
        .await
        .unwrap();
    assert_eq!(
        read().await.unwrap()[&channel][0].notification_metadata["messageId"],
        "replied"
    );
    let full =
        get_filtered_entity_notifications(&pool, viewer, vec![channel.clone()], Default::default())
            .await
            .unwrap();
    assert_eq!(
        full[&channel].len(),
        7,
        "the unfiltered edge still contains all active history"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_feed_scoping_is_viewer_and_channel_local_and_ignores_deleted_reasons(
    pool: PgPool,
) {
    let viewer = MacroUserIdStr::try_from_email("viewer@test.com").unwrap();
    let other = MacroUserIdStr::try_from_email("other@test.com").unwrap();
    let channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let another = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let witness = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Message {
            message_id: "root".into(),
        },
    )
    .await;
    let reply = Reply {
        message_id: "reply".into(),
        thread_id: "root".into(),
    };
    insert(&pool, &other, channel.clone(), None, reply.clone()).await;
    insert(&pool, &viewer, another.clone(), None, reply.clone()).await;
    let deleted = insert(&pool, &viewer, channel.clone(), None, reply).await;
    pool.delete_user_notification(viewer.clone(), deleted)
        .await
        .unwrap();
    let rows = get_filtered_entity_notifications(
        &pool,
        viewer,
        vec![channel.clone(), another.clone()],
        EntityNotificationQuery {
            states: vec![NotificationState::Unseen],
            channel_feed_only: true,
            limit: Some(1),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(rows[&channel][0].notification_id, witness);
    assert!(
        rows[&another].is_empty(),
        "a reply alone is not channel-feed activity"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_feed_preserves_mention_duplicates_and_does_not_scope_thread_edges(pool: PgPool) {
    let viewer = MacroUserIdStr::try_from_email("viewer@test.com").unwrap();
    let channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    let thread = EntityType::ChannelMessage.with_entity_string("root".to_owned());
    let root = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Message {
            message_id: "root".into(),
        },
    )
    .await;
    let reply = insert(
        &pool,
        &viewer,
        channel.clone(),
        Some(thread.clone()),
        Reply {
            message_id: "reply".into(),
            thread_id: "root".into(),
        },
    )
    .await;
    let root_mention = insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Mention {
            message_id: "root".into(),
            thread_id: None,
        },
    )
    .await;
    let reply_mention = insert(
        &pool,
        &viewer,
        channel.clone(),
        Some(thread.clone()),
        Mention {
            message_id: "reply".into(),
            thread_id: Some("root".into()),
        },
    )
    .await;
    pool.mark_notifications_seen(&viewer, &[root_mention, reply_mention])
        .await
        .unwrap();
    let query = EntityNotificationQuery {
        states: vec![NotificationState::Unseen],
        channel_feed_only: true,
        limit: Some(1),
        ..Default::default()
    };
    let rows = get_filtered_entity_notifications(
        &pool,
        viewer.clone(),
        vec![channel.clone(), thread.clone()],
        query.clone(),
    )
    .await
    .unwrap();
    assert_eq!(
        rows[&channel][0].notification_id, reply,
        "Home assigns the mention rather than its duplicate reply to the thread"
    );
    assert_eq!(
        rows[&thread][0].notification_id, reply,
        "non-channel edges keep their existing scope"
    );
    pool.mark_notifications_seen(&viewer, &[reply])
        .await
        .unwrap();
    let rows = get_filtered_entity_notifications(&pool, viewer, vec![channel.clone()], query)
        .await
        .unwrap();
    assert_eq!(rows[&channel][0].notification_id, root);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn channel_feed_badges_requests_to_join(pool: PgPool) {
    let viewer = MacroUserIdStr::try_from_email("viewer@test.com").unwrap();
    let channel = EntityType::Channel.with_entity_string(Uuid::now_v7().to_string());
    insert(
        &pool,
        &viewer,
        channel.clone(),
        None,
        Reaction {
            message_id: "reacted".into(),
        },
    )
    .await;
    let request = insert(&pool, &viewer, channel.clone(), None, AccessRequested).await;
    let rows = get_filtered_entity_notifications(
        &pool,
        viewer,
        vec![channel.clone()],
        EntityNotificationQuery {
            states: vec![NotificationState::Unseen],
            channel_feed_only: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        rows[&channel]
            .iter()
            .map(|row| row.notification_id)
            .collect::<Vec<_>>(),
        vec![request]
    );
}
