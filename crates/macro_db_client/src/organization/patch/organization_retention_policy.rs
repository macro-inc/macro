use sqlx::{Postgres, Transaction};

use crate::organization::create::organization_retention_policy::create_organization_retention_policy;

/// Updates the organizations retention policy.
/// If an organization retention policy does not currently exist, it will be created.
#[tracing::instrument(skip(transaction))]
pub async fn patch_organization_retention_policy(
    transaction: &mut Transaction<'_, Postgres>,
    organization_id: i32,
    retention_days: i32,
) -> anyhow::Result<()> {
    let retention_days_exist = sqlx::query!(
        r#"
            SELECT id
            FROM "OrganizationRetentionPolicy"
            WHERE organization_id = $1
        "#,
        organization_id
    )
    .map(|r| r.id)
    .fetch_optional(transaction.as_mut())
    .await?;

    // Create organization retention policy if it does not exist
    if retention_days_exist.is_none() {
        tracing::trace!("creating retention policy for organization");
        create_organization_retention_policy(transaction, organization_id, retention_days).await?;
        return Ok(());
    }

    sqlx::query!(
        r#"
        UPDATE "OrganizationRetentionPolicy" 
        SET "retention_days" = $2
        WHERE "organization_id" = $1
    "#,
        organization_id,
        retention_days,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}
