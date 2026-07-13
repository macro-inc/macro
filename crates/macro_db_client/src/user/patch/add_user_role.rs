/// Gives user a role
#[tracing::instrument(skip(db))]
pub async fn add_user_role(
    db: sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    role: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "RolesOnUsers" ("userId", "roleId")
        VALUES ($1, $2)
        "#,
        user_id,
        role,
    )
    .execute(&db)
    .await?;

    Ok(())
}
