/// Gets the organization email matches
#[tracing::instrument(skip(db))]
pub async fn get_organization_email_matches(
    db: sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
) -> Result<Vec<String>, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        SELECT oem.email
        FROM "OrganizationEmailMatches" oem
        JOIN "Organization" o ON o."id" = oem."organizationId"
        WHERE oem."organizationId" = $1
    "#,
        organization_id
    )
    .map(|row| row.email)
    .fetch_all(&db)
    .await?;

    Ok(result)
}
