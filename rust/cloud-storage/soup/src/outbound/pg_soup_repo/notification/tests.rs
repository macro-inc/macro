use super::*;
use chrono::{DateTime, NaiveDateTime, Utc};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_pagination::{Cursor, CursorVal, Query, SimpleSortMethod};
use serde_json::json;
use sqlx::{Pool, Postgres};

const USER_ONE: &str = "macro|notification-user-1@test.com";
const USER_TWO: &str = "macro|notification-user-2@test.com";
const SENDER: &str = "macro|notification-sender@test.com";

struct TestNotification<'a> {
    id: Uuid,
    user_id: &'a str,
    created_at: &'a str,
    event_item_id: &'a str,
    event_item_type: &'a str,
    done: bool,
    deleted_at: Option<&'a str>,
}

impl<'a> TestNotification<'a> {
    fn new(id: Uuid, user_id: &'a str, created_at: &'a str) -> Self {
        Self {
            id,
            user_id,
            created_at,
            event_item_id: "11111111-1111-1111-1111-111111111111",
            event_item_type: "document",
            done: false,
            deleted_at: None,
        }
    }

    fn with_event_item(mut self, event_item_type: &'a str, event_item_id: &'a str) -> Self {
        self.event_item_type = event_item_type;
        self.event_item_id = event_item_id;
        self
    }

    fn done(mut self) -> Self {
        self.done = true;
        self
    }

    fn deleted_at(mut self, deleted_at: &'a str) -> Self {
        self.deleted_at = Some(deleted_at);
        self
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn orders_notifications_by_user_created_at_and_id(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let oldest_id = uuid(1);
    let middle_id = uuid(2);
    let newest_id = uuid(3);

    insert_test_notification(
        &pool,
        TestNotification::new(oldest_id, USER_ONE, "2024-01-01 10:00:00"),
    )
    .await?;
    insert_test_notification(
        &pool,
        TestNotification::new(middle_id, USER_ONE, "2024-01-02 10:00:00"),
    )
    .await?;
    insert_test_notification(
        &pool,
        TestNotification::new(newest_id, USER_ONE, "2024-01-02 10:00:00")
            .with_event_item("chat", "22222222-2222-2222-2222-222222222222"),
    )
    .await?;

    let items = user_notifications(
        &pool,
        notification_request(
            MacroUserIdStr::parse_from_str(USER_ONE).unwrap(),
            10,
            Query::Sort(SimpleSortMethod::UpdatedAt, ()),
        ),
    )
    .await?;

    assert_eq!(
        notification_ids(&items),
        vec![newest_id, middle_id, oldest_id]
    );

    let notification = notification_at(&items, 0);
    assert_eq!(notification.owner_id.as_ref(), USER_ONE);
    assert_eq!(notification.event_type, "test_event");
    assert_eq!(notification.source_entity_type, EntityType::Chat);
    assert_eq!(
        notification.source_entity_id,
        "22222222-2222-2222-2222-222222222222"
    );
    assert_eq!(notification.created_at, datetime("2024-01-02 10:00:00"));
    assert_eq!(notification.updated_at, datetime("2024-01-02 10:00:00"));
    assert_eq!(
        notification.sender_id.as_ref().map(|id| id.as_ref()),
        Some(SENDER)
    );
    assert_eq!(
        notification.metadata["notificationId"],
        json!(newest_id.to_string())
    );
    assert!(notification.source.is_none());

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn uses_cursor_pagination(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let oldest_id = uuid(11);
    let middle_id = uuid(12);
    let newest_id = uuid(13);

    insert_test_notification(
        &pool,
        TestNotification::new(oldest_id, USER_ONE, "2024-01-01 10:00:00"),
    )
    .await?;
    insert_test_notification(
        &pool,
        TestNotification::new(middle_id, USER_ONE, "2024-01-02 10:00:00"),
    )
    .await?;
    insert_test_notification(
        &pool,
        TestNotification::new(newest_id, USER_ONE, "2024-01-03 10:00:00"),
    )
    .await?;

    let first_page = user_notifications(
        &pool,
        notification_request(
            MacroUserIdStr::parse_from_str(USER_ONE).unwrap(),
            2,
            Query::Sort(SimpleSortMethod::ViewedAt, ()),
        ),
    )
    .await?;
    assert_eq!(notification_ids(&first_page), vec![newest_id, middle_id]);

    let second_page = user_notifications(
        &pool,
        notification_request(
            MacroUserIdStr::parse_from_str(USER_ONE).unwrap(),
            10,
            Query::Cursor(Cursor {
                id: middle_id,
                limit: 2,
                val: CursorVal {
                    sort_type: SimpleSortMethod::ViewedAt,
                    last_val: datetime("2024-01-02 10:00:00"),
                },
                filter: (),
            }),
        ),
    )
    .await?;

    assert_eq!(notification_ids(&second_page), vec![oldest_id]);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn scopes_to_user_and_active_notifications(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let active_id = uuid(21);
    let done_id = uuid(22);
    let deleted_id = uuid(23);
    let other_user_id = uuid(24);

    insert_test_notification(
        &pool,
        TestNotification::new(active_id, USER_ONE, "2024-01-04 10:00:00"),
    )
    .await?;
    insert_test_notification(
        &pool,
        TestNotification::new(done_id, USER_ONE, "2024-01-05 10:00:00").done(),
    )
    .await?;
    insert_test_notification(
        &pool,
        TestNotification::new(deleted_id, USER_ONE, "2024-01-06 10:00:00")
            .deleted_at("2024-01-07 10:00:00"),
    )
    .await?;
    insert_test_notification(
        &pool,
        TestNotification::new(other_user_id, USER_TWO, "2024-01-08 10:00:00"),
    )
    .await?;

    let items = user_notifications(
        &pool,
        notification_request(
            MacroUserIdStr::parse_from_str(USER_ONE).unwrap(),
            10,
            Query::Sort(SimpleSortMethod::CreatedAt, ()),
        ),
    )
    .await?;

    assert_eq!(notification_ids(&items), vec![active_id]);

    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn skips_invalid_source_entity_types(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let valid_id = uuid(31);
    let invalid_id = uuid(32);

    insert_test_notification(
        &pool,
        TestNotification::new(valid_id, USER_ONE, "2024-01-01 10:00:00")
            .with_event_item("project", "33333333-3333-3333-3333-333333333333"),
    )
    .await?;
    insert_test_notification(
        &pool,
        TestNotification::new(invalid_id, USER_ONE, "2024-01-02 10:00:00")
            .with_event_item("not_a_source_type", "bad-source"),
    )
    .await?;

    let items = user_notifications(
        &pool,
        notification_request(
            MacroUserIdStr::parse_from_str(USER_ONE).unwrap(),
            10,
            Query::Sort(SimpleSortMethod::UpdatedAt, ()),
        ),
    )
    .await?;

    assert_eq!(notification_ids(&items), vec![valid_id]);
    assert_eq!(
        notification_at(&items, 0).source_entity_type,
        EntityType::Project
    );

    Ok(())
}

async fn insert_test_notification(
    pool: &Pool<Postgres>,
    notification: TestNotification<'_>,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO notification (
            id,
            notification_event_type,
            event_item_id,
            event_item_type,
            service_sender,
            created_at,
            metadata,
            sender_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        "#,
    )
    .bind(notification.id)
    .bind("test_event")
    .bind(notification.event_item_id)
    .bind(notification.event_item_type)
    .bind("soup-test")
    .bind(naive_datetime(notification.created_at))
    .bind(json!({ "notificationId": notification.id.to_string() }))
    .bind(SENDER)
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO user_notification (
            user_id,
            notification_id,
            created_at,
            sent,
            seen_at,
            deleted_at,
            done
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(notification.user_id)
    .bind(notification.id)
    .bind(naive_datetime(notification.created_at))
    .bind(true)
    .bind(Option::<NaiveDateTime>::None)
    .bind(notification.deleted_at.map(naive_datetime))
    .bind(notification.done)
    .execute(pool)
    .await?;

    Ok(())
}

fn notification_request<'a>(
    user_id: MacroUserIdStr<'a>,
    limit: u16,
    cursor: Query<Uuid, SimpleSortMethod, ()>,
) -> NotificationSortRequest<'a> {
    NotificationSortRequest {
        limit,
        cursor,
        user_id,
    }
}

fn notification_ids(items: &[SoupItem]) -> Vec<Uuid> {
    items
        .iter()
        .map(|item| notification(item).id)
        .collect::<Vec<_>>()
}

fn notification_at(items: &[SoupItem], index: usize) -> &SoupNotification {
    notification(&items[index])
}

fn notification(item: &SoupItem) -> &SoupNotification {
    match item {
        SoupItem::Notification(notification) => notification,
        _ => panic!("expected notification soup item"),
    }
}

fn uuid(value: u128) -> Uuid {
    Uuid::from_u128(value)
}

fn datetime(value: &str) -> DateTime<Utc> {
    DateTime::from_naive_utc_and_offset(naive_datetime(value), Utc)
}

fn naive_datetime(value: &str) -> NaiveDateTime {
    NaiveDateTime::parse_from_str(value, "%Y-%m-%d %H:%M:%S").unwrap()
}
