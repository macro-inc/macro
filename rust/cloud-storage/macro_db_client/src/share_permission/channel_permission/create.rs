use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::ChannelSharePermission;
use sqlx::{Postgres, Transaction};

use super::ChannelSharePermissionParamaters;

#[tracing::instrument(skip(transaction, channel_share_permissions))]
pub async fn create_channel_share_permissions(
    transaction: &mut Transaction<'_, Postgres>,
    share_permission_id: &str,
    channel_share_permissions: &Vec<ChannelSharePermission>,
) -> Result<(), sqlx::Error> {
    if channel_share_permissions.is_empty() {
        return Ok(());
    }

    let mut query = "INSERT INTO \"ChannelSharePermission\" (\"share_permission_id\", \"channel_id\", \"access_level\") VALUES ".to_string();
    let mut set_parts: Vec<String> = Vec::new();
    let mut parameters: Vec<ChannelSharePermissionParamaters> = Vec::new();

    for channel_share_permission in channel_share_permissions {
        // Start counting at 2 because 1 is the share permission id
        let param_number = parameters.len() + 2;
        set_parts.push(format!("($1, ${}, ${})", param_number, param_number + 1));

        parameters.push(ChannelSharePermissionParamaters::String(
            channel_share_permission.channel_id.to_string(),
        ));
        parameters.push(ChannelSharePermissionParamaters::AccessLevel(
            channel_share_permission.access_level,
        ));
    }

    query += &set_parts.join(", ");
    // Since this call is used in edit calls as well, there is a change the permission
    // already exists. If that is the case we need to update access level accordingly.
    query += " ON CONFLICT (\"share_permission_id\", \"channel_id\") DO NOTHING";

    let mut query = sqlx::query(&query);
    query = query.bind(share_permission_id);
    for param in parameters {
        match param {
            ChannelSharePermissionParamaters::String(string) => {
                query = query.bind(string);
            }
            ChannelSharePermissionParamaters::AccessLevel(access_level) => {
                query = query.bind(access_level);
            }
        }
    }

    query.execute(transaction.as_mut()).await?;

    Ok(())
}

/// Attempts to insert a channel share permission
/// If there is a conflict this will error
#[tracing::instrument(skip(db))]
pub async fn insert_channel_share_permission(
    db: &sqlx::Pool<sqlx::Postgres>,
    share_permission_id: &str,
    channel_id: &str,
    access_level: &AccessLevel,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            INSERT INTO "ChannelSharePermission" ("share_permission_id", "channel_id", "access_level")
            VALUES ($1, $2, $3)
        "#,
        share_permission_id,
        channel_id,
        access_level as _,
    )
    .execute(db)
    .await.map_err(|e| {
            if e.to_string().contains("duplicate key value violates unique constraint") {
                anyhow::anyhow!("channel permission already exists")
            } else {
                e.into()
            }
    })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use anyhow::Context;
    use models_permissions::share_permission::access_level::AccessLevel;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("channel_share_permissions")))]
    async fn test_insert_channel_share_permission(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // insert successfully
        insert_channel_share_permission(&pool, "sp-c1", "randomnew", &AccessLevel::View).await?;

        // insert with conflict should return access level of the existing permission
        let result = insert_channel_share_permission(&pool, "sp-c1", "c1", &AccessLevel::Edit)
            .await
            .err()
            .context("expected err")?;
        assert_eq!(result.to_string(), "channel permission already exists");

        Ok(())
    }
}
