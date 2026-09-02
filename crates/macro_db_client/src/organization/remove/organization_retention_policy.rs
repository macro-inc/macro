use sqlx::{Postgres, Transaction};

/// Removes the organization retention policy.
#[tracing::instrument(skip(transaction))]
pub async fn remove_organization_retention_policy(
    transaction: &mut Transaction<'_, Postgres>,
    organization_id: i32,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM "OrganizationRetentionPolicy"
        WHERE "organization_id" = $1
    "#,
        organization_id,
    )
    .execute(transaction.as_mut())
    .await?;
    Ok(())
}
