use sqlx::{Postgres, Transaction};

/// Removes the organization default share permission.
#[tracing::instrument(skip(transaction))]
pub async fn remove_organization_default_share_permission(
    transaction: &mut Transaction<'_, Postgres>,
    organization_id: i32,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM "OrganizationDefaultSharePermission"
        WHERE "organization_id" = $1
    "#,
        organization_id,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}
