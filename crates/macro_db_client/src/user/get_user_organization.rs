use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_user_organization(
    db: Pool<Postgres>,
    user_id: &str,
) -> Result<Option<i32>, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        SELECT
            u."organizationId" as organization_id
        FROM
            "User" u
        WHERE
            u.id = $1
        "#,
        user_id,
    )
    .fetch_one(&db)
    .await?;

    Ok(result.organization_id)
}
