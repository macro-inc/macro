/// Deletes a user from the database
#[tracing::instrument(skip(db))]
pub async fn delete_user(db: sqlx::Pool<sqlx::Postgres>, user_id: &str) -> anyhow::Result<()> {
    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, user_id)
        .execute(&db)
        .await?;

    Ok(())
}
