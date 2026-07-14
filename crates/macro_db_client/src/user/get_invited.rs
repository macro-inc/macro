/// Gets all invited users in a given organization
#[tracing::instrument(skip(db))]
pub async fn get_invited_users_by_organization(
    db: sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
) -> anyhow::Result<Vec<String>> {
    let emails = sqlx::query!(
        r#"
        SELECT
            oi.email
        FROM "OrganizationInvitation" oi
        WHERE oi.organization_id = $1
    "#,
        organization_id,
    )
    .map(|r| r.email)
    .fetch_all(&db)
    .await?;

    Ok(emails)
}
