/// Gets whether the organization is allow list only
pub async fn get_allow_list_only(
    db: sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        SELECT "allowListOnly" as allow_list_only
        FROM "Organization"
        WHERE id = $1
        "#,
        organization_id
    )
    .map(|row| row.allow_list_only.unwrap_or(false))
    .fetch_one(&db)
    .await?;

    Ok(result)
}

#[tracing::instrument(skip(db))]
pub async fn get_organization_name(
    db: &sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
) -> anyhow::Result<String> {
    let result = sqlx::query!(
        r#"
        SELECT
            name
        FROM
            "Organization"
        WHERE id = $1
        "#,
        organization_id
    )
    .map(|row| row.name)
    .fetch_one(db)
    .await?;

    Ok(result)
}
