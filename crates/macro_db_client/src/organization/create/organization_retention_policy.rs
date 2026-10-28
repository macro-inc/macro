use sqlx::{Postgres, Transaction};

/// Creates the organization retention policy.
#[tracing::instrument(skip(transaction))]
pub async fn create_organization_retention_policy(
    transaction: &mut Transaction<'_, Postgres>,
    organization_id: i32,
    retention_days: i32,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
    INSERT INTO "OrganizationRetentionPolicy" (organization_id, retention_days)
    VALUES ($1, $2)
    "#,
        organization_id,
        retention_days,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}
