use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermissionRow;

/// Retrieves all ChannelSharePermission rows for a specific channel ID
/// This is useful for identifying all items shared with a particular channel
#[tracing::instrument(skip(db))]
pub async fn get_channel_share_permissions_by_channel_id(
    db: &sqlx::Pool<sqlx::Postgres>,
    channel_id: &str,
) -> anyhow::Result<Vec<ChannelSharePermissionRow>> {
    let results = sqlx::query!(
        r#"
        SELECT
            channel_id,
            share_permission_id,
            access_level as "access_level: AccessLevel"
        FROM
            "ChannelSharePermission"
        WHERE
            channel_id = $1
        "#,
        channel_id
    )
    .map(|row| ChannelSharePermissionRow {
        channel_id: row.channel_id,
        share_permission_id: row.share_permission_id,
        access_level: row.access_level,
    })
    .fetch_all(db)
    .await?;

    Ok(results)
}

#[cfg(test)]
mod tests {
    use crate::share_permission::channel_permission::get::get_channel_share_permissions_by_channel_id;
    use models_permissions::share_permission::access_level::AccessLevel;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("channel_share_permissions")))]
    async fn test_get_channel_share_permissions_by_channel_id_c1(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let permissions = get_channel_share_permissions_by_channel_id(&pool, "c1").await?;

        // c1 is used in 3 share permissions (sp-p1, sp-d1, sp-c1)
        assert_eq!(permissions.len(), 3);

        // Sort by share permission ID to ensure consistent order for assertions
        let mut sorted_permissions = permissions;
        sorted_permissions.sort_by(|a, b| a.share_permission_id.cmp(&b.share_permission_id));

        // Check the first permission (sp-c1)
        assert_eq!(sorted_permissions[0].channel_id, "c1");
        assert_eq!(sorted_permissions[0].share_permission_id, "sp-c1");
        assert_eq!(sorted_permissions[0].access_level, AccessLevel::View);

        // Check the second permission (sp-d1)
        assert_eq!(sorted_permissions[1].channel_id, "c1");
        assert_eq!(sorted_permissions[1].share_permission_id, "sp-d1");
        assert_eq!(sorted_permissions[1].access_level, AccessLevel::View);

        // Check the third permission (sp-p1)
        assert_eq!(sorted_permissions[2].channel_id, "c1");
        assert_eq!(sorted_permissions[2].share_permission_id, "sp-p1");
        assert_eq!(sorted_permissions[2].access_level, AccessLevel::View);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("channel_share_permissions")))]
    async fn test_get_channel_share_permissions_by_channel_id_c2(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let permissions = get_channel_share_permissions_by_channel_id(&pool, "c2").await?;

        // c2 is used in 3 share permissions (sp-p1, sp-d1, sp-c1)
        assert_eq!(permissions.len(), 3);

        // Sort by share permission ID to ensure consistent order for assertions
        let mut sorted_permissions = permissions;
        sorted_permissions.sort_by(|a, b| a.share_permission_id.cmp(&b.share_permission_id));

        // Check the first permission (sp-c1)
        assert_eq!(sorted_permissions[0].channel_id, "c2");
        assert_eq!(sorted_permissions[0].share_permission_id, "sp-c1");
        assert_eq!(sorted_permissions[0].access_level, AccessLevel::Edit);

        // Check the second permission (sp-d1)
        assert_eq!(sorted_permissions[1].channel_id, "c2");
        assert_eq!(sorted_permissions[1].share_permission_id, "sp-d1");
        assert_eq!(sorted_permissions[1].access_level, AccessLevel::Edit);

        // Check the third permission (sp-p1)
        assert_eq!(sorted_permissions[2].channel_id, "c2");
        assert_eq!(sorted_permissions[2].share_permission_id, "sp-p1");
        assert_eq!(sorted_permissions[2].access_level, AccessLevel::Edit);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("channel_share_permissions")))]
    async fn test_get_channel_share_permissions_by_channel_id_nonexistent(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let permissions =
            get_channel_share_permissions_by_channel_id(&pool, "nonexistent-channel").await?;

        // Should return an empty vector for non-existent channel
        assert!(permissions.is_empty());

        Ok(())
    }
}
