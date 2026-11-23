use super::*;
use crate::domain::models::{Notification, SendNotificationRequestBuilder, TaggedContent};
use crate::outbound::repository::NotificationDbOps;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::EntityType;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Clone, Serialize, Deserialize)]
struct DocumentMention;
impl Notification for DocumentMention {
    const TYPE_NAME: &'static str = "document_mention";
}
#[derive(Clone, Serialize, Deserialize)]
struct ChannelMention;
impl Notification for ChannelMention {
    const TYPE_NAME: &'static str = "channel_mention";
}
#[derive(Clone, Serialize, Deserialize)]
struct MessageSend;
impl Notification for MessageSend {
    const TYPE_NAME: &'static str = "channel_message_send";
}

async fn insert<T: Notification + Serialize + Send + Sync>(
    pool: &PgPool,
    user: &MacroUserIdStr<'static>,
    notification: T,
) -> Uuid {
    let id = Uuid::now_v7();
    pool.create_notification(
        SendNotificationRequestBuilder {
            notification_entity: EntityType::Channel.with_entity_string(Uuid::now_v7().to_string()),
            secondary_notification_entity: None,
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
async fn reads_only_the_users_active_rows_of_the_requested_types_newest_first(pool: PgPool) {
    let viewer = MacroUserIdStr::try_from_email("viewer@example.com").unwrap();
    let other = MacroUserIdStr::try_from_email("other@example.com").unwrap();
    let oldest = insert(&pool, &viewer, DocumentMention).await;
    let mention = insert(&pool, &viewer, ChannelMention).await;
    let seen = insert(&pool, &viewer, DocumentMention).await;
    pool.mark_notifications_seen(&viewer, &[seen])
        .await
        .unwrap();
    let done = insert(&pool, &viewer, DocumentMention).await;
    pool.mark_notifications_done(&viewer, &[done], true)
        .await
        .unwrap();
    let deleted = insert(&pool, &viewer, DocumentMention).await;
    pool.delete_user_notification(viewer.clone(), deleted)
        .await
        .unwrap();
    insert(&pool, &viewer, MessageSend).await;
    insert(&pool, &other, DocumentMention).await;
    let newest = insert(&pool, &viewer, DocumentMention).await;
    let repository = PgActiveNotificationIdRepository(pool);
    let event_types = vec!["channel_mention".to_owned(), "document_mention".to_owned()];

    let all = repository
        .active_notification_ids(viewer.clone(), &event_types, 10)
        .await
        .unwrap();
    let first_two = repository
        .active_notification_ids(viewer.clone(), &event_types, 2)
        .await
        .unwrap();
    let sends = repository
        .active_notification_ids(other, &["channel_message_send".to_owned()], 10)
        .await
        .unwrap();

    assert_eq!(all, vec![newest, seen, mention, oldest]);
    assert_eq!(first_two, vec![newest, seen]);
    assert!(sends.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_statement_timeout_maps_to_timed_out_and_other_errors_to_failed(pool: PgPool) {
    let mut transaction = pool.begin().await.unwrap();
    sqlx::query!("SET LOCAL statement_timeout = '10ms'")
        .execute(&mut *transaction)
        .await
        .unwrap();
    let timeout = sqlx::query!("SELECT pg_sleep(1)")
        .execute(&mut *transaction)
        .await
        .unwrap_err();
    drop(transaction);
    let other = sqlx::query!("SELECT CAST($1::text AS integer) AS value", "not a number")
        .fetch_one(&pool)
        .await
        .unwrap_err();

    assert!(matches!(
        storage_error(timeout),
        ActiveNotificationIdStorageError::TimedOut
    ));
    assert!(matches!(
        storage_error(other),
        ActiveNotificationIdStorageError::Failed(_)
    ));
}
