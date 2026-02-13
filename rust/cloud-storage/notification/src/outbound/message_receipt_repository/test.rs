use super::*;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

fn test_user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("message_receipts"))
)]
async fn test_record_message_id(pool: Pool<Postgres>) {
    let repo = DbMessageReceiptRepository::new(pool.clone());
    let user = test_user("receipt_user@test.com");
    let notification_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77").unwrap();

    let result = repo
        .record_message_id(MessageId("new-msg-1".to_string()), user, notification_id)
        .await;

    assert!(result.is_ok());

    // Verify insertion
    let row = sqlx::query!(
        "SELECT message_id FROM notification_message_receipt WHERE message_id = $1",
        "new-msg-1"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.message_id, "new-msg-1");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("message_receipts"))
)]
async fn test_record_message_id_idempotent(pool: Pool<Postgres>) {
    let repo = DbMessageReceiptRepository::new(pool.clone());
    let user = test_user("receipt_user@test.com");
    let notification_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77").unwrap();

    // First insert
    repo.record_message_id(
        MessageId("idempotent-msg".to_string()),
        user.copied(),
        notification_id,
    )
    .await
    .unwrap();

    // Second insert with same message_id should not error
    let result = repo
        .record_message_id(
            MessageId("idempotent-msg".to_string()),
            user,
            notification_id,
        )
        .await;

    assert!(result.is_ok());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("message_receipts"))
)]
async fn test_mark_message_failed(pool: Pool<Postgres>) {
    let repo = DbMessageReceiptRepository::new(pool.clone());

    // msg-1 is inserted by fixture and not failed
    let (user_id, notification_id) = repo
        .mark_message_failed(MessageId("msg-1".to_string()))
        .await
        .unwrap();

    assert_eq!(user_id.email_part().as_ref(), "receipt_user@test.com");
    assert_eq!(
        notification_id,
        uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77").unwrap()
    );

    // Verify failed flag is set
    let row = sqlx::query!(
        "SELECT failed FROM notification_message_receipt WHERE message_id = $1",
        "msg-1"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(row.failed);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("message_receipts"))
)]
async fn test_did_all_messages_fail_returns_false_when_some_not_failed(pool: Pool<Postgres>) {
    let repo = DbMessageReceiptRepository::new(pool);
    let user = test_user("receipt_user@test.com");
    let notification_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77").unwrap();

    // Fixture has msg-1 (not failed) and msg-2 (failed)
    let result = repo
        .did_all_messages_fail(user, notification_id)
        .await
        .unwrap();

    assert!(!result);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("message_receipts"))
)]
async fn test_did_all_messages_fail_returns_true_when_all_failed(pool: Pool<Postgres>) {
    let repo = DbMessageReceiptRepository::new(pool);
    let user = test_user("receipt_user@test.com");
    let notification_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77").unwrap();

    // Mark msg-1 as failed too (msg-2 is already failed in fixture)
    repo.mark_message_failed(MessageId("msg-1".to_string()))
        .await
        .unwrap();

    let result = repo
        .did_all_messages_fail(user, notification_id)
        .await
        .unwrap();

    assert!(result);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn test_did_all_messages_fail_returns_true_when_no_messages(pool: Pool<Postgres>) {
    let repo = DbMessageReceiptRepository::new(pool);
    let user = test_user("nonexistent@test.com");
    let notification_id = uuid::Uuid::new_v4();

    // No messages exist - should return true (vacuously all failed)
    let result = repo
        .did_all_messages_fail(user, notification_id)
        .await
        .unwrap();

    assert!(result);
}
