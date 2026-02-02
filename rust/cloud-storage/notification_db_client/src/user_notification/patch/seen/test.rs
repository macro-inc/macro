use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_notifications"))
)]
async fn test_patch_seen(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let notification_id = "0193b1ea-a542-7589-893b-2b4a509c1e76";
    let user_id = "macro|user@user.com";

    patch_seen(&pool, notification_id, user_id).await?;

    let notification = sqlx::query!(
            r#"
            SELECT seen_at as "seen_at?" FROM user_notification WHERE notification_id = $1 AND user_id = $2
            "#,
            macro_uuid::string_to_uuid(notification_id)?,
            user_id,
        )
        .fetch_one(&pool)
        .await?;

    assert!(notification.seen_at.is_some());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_notifications"))
)]
async fn test_bulk_patch_seen(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = "macro|user@user.com";
    let notification_ids = vec![
        macro_uuid::string_to_uuid("0193b1ea-a542-7589-893b-2b4a509c1e76")?,
        macro_uuid::string_to_uuid("0193b1ea-a542-7589-893b-2b4a509c1e75")?,
    ];

    // Before patching, verify that these notifications are not marked as seen.
    for notif_id in &notification_ids {
        let rec = sqlx::query!(
            r#"
            SELECT seen_at as "seen_at?" FROM user_notification
            WHERE user_id = $1 AND notification_id = $2
            "#,
            user_id,
            notif_id,
        )
        .fetch_one(&pool)
        .await?;
        assert!(
            rec.seen_at.is_none(),
            "Notification {} is already marked as seen",
            notif_id
        );
    }

    // Perform bulk patch: mark the notifications as seen.
    bulk_patch_seen(&pool, user_id, &notification_ids).await?;

    // Verify that the notifications are now marked as seen.
    for notif_id in &notification_ids {
        let rec = sqlx::query!(
            r#"
            SELECT seen_at as "seen_at?" FROM user_notification
            WHERE user_id = $1 AND notification_id = $2
            "#,
            user_id,
            notif_id,
        )
        .fetch_one(&pool)
        .await?;
        assert!(
            rec.seen_at.is_some(),
            "Notification {} was not marked as seen",
            notif_id
        );
    }

    Ok(())
}
