use super::*;
use sqlx::{Pool, Postgres};

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_notification")))]
async fn test_get_basic_notification(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let notification_id = macro_uuid::string_to_uuid("0193b1ea-a542-7589-893b-2b4a509c1e76")?;

    let result = get_basic_notification(&pool, &notification_id).await?;

    assert_eq!(result.event_item_id, "item-123");
    assert_eq!(result.event_item_type, "document");
    assert_eq!(result.notification_event_type, "message");
    assert!(result.apns_collapse_key.is_none());

    Ok(())
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("basic_notification")))]
async fn test_update_basic_notification(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let notification_id = macro_uuid::string_to_uuid("0193b1ea-a542-7589-893b-2b4a509c1e76")?;
    let collapse_key = "test-collapse-key";

    let result = update_collapse_key(&pool, &notification_id, collapse_key).await?;

    assert_eq!(result.event_item_id, "item-123");
    assert_eq!(result.event_item_type, "document");
    assert_eq!(result.notification_event_type, "message");
    assert_eq!(result.apns_collapse_key, collapse_key);

    Ok(())
}
