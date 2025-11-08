use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::{Postgres, Transaction};

#[tracing::instrument(skip(transaction))]
pub async fn edit_channel_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    channel_share_permissions: &[UpdateChannelSharePermission],
) -> anyhow::Result<()> {
    // Sort into add, replace and remove
    let to_upsert = channel_share_permissions
        .iter()
        .filter_map(
            |channel_share_permission| match channel_share_permission.operation {
                UpdateOperation::Add | UpdateOperation::Replace => {
                    Some(channel_share_permission.into())
                }
                _ => None,
            },
        )
        .collect::<Vec<ChannelSharePermission>>();

    let to_remove: Vec<String> = channel_share_permissions
        .iter()
        .filter_map(
            |channel_share_permission| match channel_share_permission.operation {
                UpdateOperation::Remove => Some(channel_share_permission.channel_id.clone()),
                _ => None,
            },
        )
        .collect();

    remove_channel_share_permissions(transaction, share_permission_id, &to_remove).await?;
    upsert_channel_share_permissions(transaction, share_permission_id, &to_upsert).await?;

    Ok(())
}

#[tracing::instrument(skip(transaction))]
pub async fn upsert_channel_share_permissions(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    channel_share_permissions: &[ChannelSharePermission],
) -> anyhow::Result<()> {
    if channel_share_permissions.is_empty() {
        return Ok(());
    }

    // Extract arrays from the channel_share_permissions
    let channel_ids: Vec<String> = channel_share_permissions
        .iter()
        .map(|csp| csp.channel_id.clone())
        .collect();

    let access_levels: Vec<String> = channel_share_permissions
        .iter()
        .map(|csp| csp.access_level.to_string())
        .collect();

    sqlx::query!(
        r#"
        INSERT INTO "ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
        SELECT $1, channel_id, access_level::"AccessLevel"
        FROM UNNEST($2::text[], $3::text[]) AS t(channel_id, access_level)
        ON CONFLICT ("share_permission_id", "channel_id") 
        DO UPDATE SET "access_level" = EXCLUDED."access_level"
        "#,
        share_permission_id,
        &channel_ids,
        &access_levels,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

#[tracing::instrument(skip(transaction))]
pub async fn remove_channel_share_permissions(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    channel_share_permissions: &[String],
) -> anyhow::Result<()> {
    if channel_share_permissions.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        DELETE FROM "ChannelSharePermission"
        WHERE "share_permission_id" = $1
        AND "channel_id" = ANY($2)
        "#,
        share_permission_id,
        channel_share_permissions,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use models_permissions::share_permission::access_level::AccessLevel;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("channel_share_permissions")))]
    async fn test_upsert_channel_share_permissions(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // insert successfully
        let channel_share_permissions = vec![
            // add
            ChannelSharePermission {
                channel_id: "new".to_string(),
                access_level: AccessLevel::View,
            },
            // update
            ChannelSharePermission {
                channel_id: "c2".to_string(),
                access_level: AccessLevel::Owner,
            },
        ];
        let mut transaction = pool.begin().await?;
        upsert_channel_share_permissions(&mut transaction, "sp-p1", &channel_share_permissions)
            .await?;

        transaction.commit().await?;

        let mut channel_share_permissions: Vec<(String, String)> = sqlx::query!(
            r#"
            SELECT 
                channel_id, 
                access_level::text as "access_level!"
            FROM "ChannelSharePermission"
            WHERE "share_permission_id" = 'sp-p1'
            "#,
        )
        .map(|row| (row.channel_id, row.access_level))
        .fetch_all(&pool)
        .await?;

        channel_share_permissions.sort();

        assert_eq!(
            channel_share_permissions,
            vec![
                ("c1".to_string(), "view".to_string()),  // no change
                ("c2".to_string(), "owner".to_string()), // change
                ("new".to_string(), "view".to_string()), // new
            ]
        );

        Ok(())
    }
}
