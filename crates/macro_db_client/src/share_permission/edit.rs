use model_entity::EntityType;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use sqlx::{Postgres, QueryBuilder, Transaction};

use super::channel_permission::edit::edit_channel_share_permission;
use super::create::link_share_access_level_or_default;

#[tracing::instrument(skip(transaction))]
#[allow(
    clippy::disallowed_methods,
    reason = "optional update fields require a dynamically assembled SQL query"
)]
pub async fn edit_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &uuid::Uuid,
    entity_type: EntityType,
    share_permission_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    // The optional update fields determine which assignments are present, so this query must be
    // assembled dynamically. Every value remains bound; only trusted SQL fragments are appended.
    let mut query =
        QueryBuilder::<Postgres>::new(r#"UPDATE "SharePermission" SET "updatedAt" = NOW()"#);

    match share_permission.link_share {
        Some(Some(link_share)) => {
            let access_level = link_share_access_level_or_default(
                share_permission.link_share_access_level.flatten(),
            );

            query
                .push(r#", "linkShare" = "#)
                .push_bind(link_share.to_string())
                .push(r#", "linkShareAccessLevel" = "#)
                .push_bind(access_level);
        }
        Some(None) => {
            query.push(r#", "linkShare" = NULL, "linkShareAccessLevel" = NULL"#);
        }
        None => match share_permission.link_share_access_level {
            Some(Some(access_level)) => {
                query
                    .push(
                        r#", "linkShareAccessLevel" = CASE WHEN "linkShare" IS NULL THEN NULL ELSE "#,
                    )
                    .push_bind(access_level)
                    .push(" END");
            }
            Some(None) => {
                query
                    .push(
                        r#", "linkShareAccessLevel" = CASE WHEN "linkShare" IS NULL THEN NULL ELSE "#,
                    )
                    .push_bind(link_share_access_level_or_default(None))
                    .push(" END");
            }
            None => {}
        },
    }

    query.push(" WHERE id = ").push_bind(share_permission_id);
    query.build().execute(transaction.as_mut()).await?;

    if let Some(channel_share_permissions) = share_permission.channel_share_permissions.as_ref() {
        edit_channel_share_permission(transaction, share_permission_id, channel_share_permissions)
            .await?;

        entity_access_db_utils::update_entity_access_channel_share_permissions(
            transaction,
            entity_id,
            entity_type,
            channel_share_permissions,
        )
        .await?;
    }

    Ok(())
}

#[tracing::instrument(skip(transaction))]
pub async fn edit_thread_permission(
    transaction: &mut Transaction<'_, Postgres>,
    thread_id: &uuid::Uuid,
    share_permission_id: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    edit_share_permission(
        transaction,
        thread_id,
        EntityType::EmailThread,
        share_permission_id,
        share_permission,
    )
    .await
}

#[cfg(test)]
mod test;
