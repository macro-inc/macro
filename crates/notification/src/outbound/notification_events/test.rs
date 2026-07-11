use super::*;

use crate::inbound::notification_events_listener::NotificationDatabaseEvent;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::Postgres;
use uuid::Uuid;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notification_delete_trigger_notifies_affected_users(pool: sqlx::Pool<Postgres>) {
    let mut receiver = PgNotificationEventsReceiver::new(pool.clone());
    receiver.listener().await.unwrap();

    let notification_id = Uuid::new_v4();
    let user_a = "macro|notify-a@test.com";
    let user_b = "macro|notify-b@test.com";

    sqlx::query(
        r#"
        INSERT INTO notification (
            id,
            notification_event_type,
            event_item_id,
            event_item_type,
            service_sender
        ) VALUES ($1, 'test_notification', 'doc-1', 'document', 'test_service')
        "#,
    )
    .bind(notification_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO user_notification (user_id, notification_id)
        VALUES ($1, $3), ($2, $3)
        "#,
    )
    .bind(user_a)
    .bind(user_b)
    .bind(notification_id)
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query("DELETE FROM notification WHERE id = $1")
        .bind(notification_id)
        .execute(&pool)
        .await
        .unwrap();

    let payload = tokio::time::timeout(std::time::Duration::from_secs(2), receiver.receive())
        .await
        .expect("notification should be received")
        .unwrap();
    let payload: NotificationDatabaseEvent = serde_json::from_str(&payload).unwrap();

    let NotificationDatabaseEvent::UserNotificationDeletes {
        notification_id: received_notification_id,
        mut user_ids,
    } = payload;

    assert_eq!(received_notification_id, notification_id);
    user_ids.sort();
    assert_eq!(user_ids, vec![user_a.to_string(), user_b.to_string()]);
}
