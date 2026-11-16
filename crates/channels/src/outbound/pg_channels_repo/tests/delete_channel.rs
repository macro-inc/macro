use super::{insert_channel_message_notification, macro_user_id, repo};
use crate::domain::models::{ChannelType, CreateChannelRequest};
use crate::domain::ports::ChannelRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use std::collections::HashSet;
use uuid::Uuid;

const OWNER: &str = "macro|delete-owner@example.com";
const MEMBER: &str = "macro|delete-member@example.com";

async fn create_channel(pool: &Pool<Postgres>, name: &str) -> Uuid {
    repo(pool.clone())
        .create_channel(
            macro_user_id(OWNER),
            None,
            CreateChannelRequest {
                name: Some(name.to_string()),
                channel_type: ChannelType::Private,
                team_id: None,
                auto_join_team: false,
                participants: HashSet::new(),
            },
        )
        .await
        .unwrap()
        .id
}

async fn channel_notification_counts(pool: &Pool<Postgres>, channel_id: Uuid) -> (i64, i64) {
    let notifications = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM notification
           WHERE event_item_type = 'channel' AND event_item_id = $1"#,
        channel_id.to_string(),
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let user_notifications = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM user_notification
           WHERE event_item_type = 'channel' AND event_item_id = $1"#,
        channel_id.to_string(),
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (notifications, user_notifications)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_channel_deletes_only_its_notifications(pool: Pool<Postgres>) {
    let deleted = create_channel(&pool, "deleted").await;
    let kept = create_channel(&pool, "kept").await;
    for (channel_id, done) in [(deleted, false), (deleted, true), (kept, false)] {
        insert_channel_message_notification(&pool, MEMBER, channel_id, Uuid::now_v7(), done, false)
            .await
            .unwrap();
    }

    repo(pool.clone()).delete_channel(deleted).await.unwrap();

    assert_eq!(channel_notification_counts(&pool, deleted).await, (0, 0));
    assert_eq!(channel_notification_counts(&pool, kept).await, (1, 1));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_notification_queued_before_the_delete_is_not_created_after_it(pool: Pool<Postgres>) {
    let deleted = create_channel(&pool, "deleted").await;
    repo(pool.clone()).delete_channel(deleted).await.unwrap();

    insert_channel_message_notification(&pool, MEMBER, deleted, Uuid::now_v7(), false, false)
        .await
        .unwrap();

    assert_eq!(channel_notification_counts(&pool, deleted).await, (0, 0));
}
