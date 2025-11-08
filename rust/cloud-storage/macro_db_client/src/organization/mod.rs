pub mod create;
pub mod get;
pub mod patch;
pub mod remove;

// organization invitation delete
pub async fn delete_organization_invitation(
    db: sqlx::Pool<sqlx::Postgres>,
    email: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        DELETE FROM "OrganizationInvitation"
        WHERE email = $1
        "#,
        email
    )
    .execute(&db)
    .await?;

    Ok(())
}
