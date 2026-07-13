use model::organization::OrganizationSettings;

/// Gets the settings for an organization
#[tracing::instrument(skip(db))]
pub async fn get_organization_settings(
    db: sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
) -> anyhow::Result<OrganizationSettings> {
    let result = sqlx::query!(
        r#"
        SELECT
            o.name as name,
            orp.retention_days as "retention_days?"
        FROM "Organization" o
        LEFT JOIN "OrganizationRetentionPolicy" orp ON o.id = orp.organization_id
        WHERE o.id = $1
    "#,
        organization_id
    )
    .map(|row| OrganizationSettings {
        name: row.name,
        retention_days: row.retention_days,
        default_share_permission: None,
    })
    .fetch_one(&db)
    .await?;

    Ok(result)
}
