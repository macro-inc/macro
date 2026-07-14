use model::user::UserInfo;

/// Gets the user id by email
#[tracing::instrument(skip(db))]
pub async fn get_user_by_email(
    db: sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> Result<Option<(String, Option<i32>)>, sqlx::Error> {
    let result= sqlx::query!(
        r#"SELECT "id" as user_id, "organizationId" as "organization_id?" FROM "User" WHERE "email" = $1"#,
        email
    )
    .map(|r| (r.user_id, r.organization_id))
    .fetch_optional(&db)
    .await?;

    Ok(result)
}

#[tracing::instrument(skip(db))]
pub async fn get_user_info_by_email(
    db: sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> anyhow::Result<UserInfo> {
    let result: UserInfo = sqlx::query!(
        r#"
        SELECT
            u.id,
            u."organizationId" as organization_id
        FROM
            "User" u
        WHERE
            u.email = $1
        "#,
        email,
    )
    .map(|r| UserInfo {
        id: r.id,
        email: email.to_string(),
        organization_id: r.organization_id,
    })
    .fetch_one(&db)
    .await?;

    Ok(result)
}
