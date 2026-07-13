/// Removes the user's role
#[tracing::instrument(skip(db))]
pub async fn remove_user_role(
    db: sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    role: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM "RolesOnUsers" WHERE "userId" = $1 AND "roleId" = $2
        "#,
        user_id,
        role,
    )
    .execute(&db)
    .await?;

    Ok(())
}
