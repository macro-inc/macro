/// Gets the user's organization id
#[tracing::instrument(skip(db))]
pub async fn get_user_organization(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
) -> Result<Option<i32>, sqlx::Error> {
    let organization_id = sqlx::query!(
        r#"SELECT "organizationId" as organization_id FROM "User" WHERE id = $1"#,
        user_id
    )
    .map(|r| r.organization_id)
    .fetch_one(db)
    .await?;

    Ok(organization_id)
}
