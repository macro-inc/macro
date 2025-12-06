use super::*;
use sqlx::{Pool, Postgres};

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]
async fn test_delete_user_notification(pool: Pool<Postgres>) -> anyhow::Result<()> {
    delete_user_notification(
        &pool,
        "0193b1ea-a542-7589-893b-2b4a509c1e74",
        "macro|user@user.com",
    )
    .await?;

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("user_notifications")))]
async fn test_bulk_delete_user_notification(pool: Pool<Postgres>) -> anyhow::Result<()> {
    bulk_delete_user_notification(
        &pool,
        "macro|user@user.com",
        &vec![
            macro_uuid::string_to_uuid("0193b1ea-a542-7589-893b-2b4a509c1e76")?,
            macro_uuid::string_to_uuid("0193b1ea-a542-7589-893b-2b4a509c1e75")?,
        ],
    )
    .await?;

    Ok(())
}
