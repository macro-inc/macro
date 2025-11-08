use anyhow::Context;
use comms_service_client::CommsServiceClient;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::UpdateOperation;
use sqlx::Postgres;
use sqlx::types::uuid;

/// Updates user access for channel share permissions
///
/// This function handles the logic for adding/removing user access items based on
/// channel share permissions in the UpdateSharePermissionRequestV2
#[tracing::instrument(skip(transaction, comms_service_client))]
pub async fn update_user_item_access<'t>(
    transaction: &mut sqlx::Transaction<'t, Postgres>,
    comms_service_client: &CommsServiceClient,
    user_id: &str,
    item_id: &str,
    item_type: &str,
    share_permission: &UpdateSharePermissionRequestV2,
) -> anyhow::Result<()> {
    if let Some(csps) = &share_permission.channel_share_permissions {
        for csp in csps.iter() {
            let channel_id = uuid::Uuid::parse_str(&csp.channel_id)
                .with_context(|| format!("Failed to parse channel_id {}", &csp.channel_id))?;

            let channel_participants = comms_service_client
                .get_channel_participants(&csp.channel_id)
                .await
                .with_context(|| {
                    format!(
                        "Failed to get channel participants for channel {}",
                        &csp.channel_id
                    )
                })?
                .into_iter()
                // don't make another entry for the owner of the item
                .filter(|p| p.user_id != user_id && p.left_at.is_none())
                .map(|p| p.user_id)
                .collect::<Vec<_>>();

            if channel_participants.is_empty() {
                continue;
            }

            match csp.operation {
                UpdateOperation::Add | UpdateOperation::Replace => {
                    macro_db_client::item_access::insert::upsert_user_item_access_bulk(
                        &mut **transaction,
                        &channel_participants,
                        item_id,
                        item_type,
                        csp.access_level.unwrap_or(AccessLevel::View),
                        Some(channel_id),
                    )
                    .await
                    .with_context(|| "Failed to insert user item access rows")?;
                }
                UpdateOperation::Remove => {
                    macro_db_client::item_access::delete::delete_user_item_access_by_users_and_channel(
                        &mut **transaction,
                        &channel_participants,
                        item_id,
                        item_type,
                        channel_id,
                    )
                        .await
                        .with_context(|| "Failed to delete user item access rows")?;
                }
            }
        }
    }

    Ok(())
}
