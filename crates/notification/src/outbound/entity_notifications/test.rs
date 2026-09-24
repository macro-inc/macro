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
