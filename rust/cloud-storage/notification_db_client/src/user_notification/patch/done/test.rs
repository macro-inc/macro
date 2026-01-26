use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_notifications"))
)]
async fn test_bulk_patch_undone(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = "macro|user@user.com";
    let notification_ids = vec![
        macro_uuid::string_to_uuid("0193b1ea-a542-7589-893b-2b4a509c1e76")?,
        macro_uuid::string_to_uuid("0193b1ea-a542-7589-893b-2b4a509c1e75")?,
    ];

    // Before patching mark the notifications as done.
    for notif_id in &notification_ids {
        patch_done(&pool, &notif_id.to_string(), user_id).await?;
    }

    bulk_patch_done(&pool, user_id, &notification_ids, false).await?;

    // Verify that the notifications are now marked as undone.
    for notif_id in &notification_ids {
        let rec = sqlx::query!(
            r#"
            SELECT done as "done" FROM user_notification
            WHERE user_id = $1 AND notification_id = $2
            "#,
            user_id,
            notif_id
        )
        .fetch_one(&pool)
        .await?;
        assert!(
            !rec.done,
            "Notification {} was not marked as undone",
            notif_id
        );
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_notifications"))
)]
async fn test_patch_done(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let notification_id = "0193b1ea-a542-7589-893b-2b4a509c1e76";
    let user_id = "macro|user@user.com";

    patch_done(&pool, notification_id, user_id).await?;

    let notification: bool = sqlx::query!(
        r#"
            SELECT done as "done" FROM user_notification WHERE notification_id = $1 AND user_id = $2
            "#,
        macro_uuid::string_to_uuid(notification_id)?,
        user_id,
    )
    .map(|n| n.done)
    .fetch_one(&pool)
    .await?;

    assert!(notification);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_notifications"))
)]
async fn test_bulk_patch_done(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let user_id = "macro|user@user.com";
    let notification_ids = vec![
        macro_uuid::string_to_uuid("0193b1ea-a542-7589-893b-2b4a509c1e76")?,
        macro_uuid::string_to_uuid("0193b1ea-a542-7589-893b-2b4a509c1e75")?,
    ];

    // Before patching, verify that these notifications are not marked as done.
    for notif_id in &notification_ids {
        let rec = sqlx::query!(
            r#"
            SELECT done as "done" FROM user_notification
            WHERE user_id = $1 AND notification_id = $2
            "#,
            user_id,
            notif_id
        )
        .fetch_one(&pool)
        .await?;
        assert!(
            !rec.done,
            "Notification {} is already marked as done",
            notif_id
        );
    }

    // Perform bulk patch: mark the notifications as done.
    bulk_patch_done(&pool, user_id, &notification_ids, true).await?;

    // Verify that the notifications are now marked as done.
    for notif_id in &notification_ids {
        let rec = sqlx::query!(
            r#"
            SELECT done as "done" FROM user_notification
            WHERE user_id = $1 AND notification_id = $2
            "#,
            user_id,
            notif_id
        )
        .fetch_one(&pool)
        .await?;
        assert!(rec.done, "Notification {} was not marked as done", notif_id);
    }

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_notifications"))
)]
async fn test_bulk_patch_done_by_event(pool: Pool<Postgres>) -> anyhow::Result<()> {
    bulk_patch_done_by_event(&pool, "macro|user@user.com", "test").await?;

    Ok(())
}
