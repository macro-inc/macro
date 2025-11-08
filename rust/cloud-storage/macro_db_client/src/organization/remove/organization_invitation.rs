pub async fn revoke_organization_invitation_for_user(
    db: sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
    email: &str,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;

    sqlx::query!(
        r#"DELETE FROM "OrganizationInvitation" WHERE organization_id = $1 AND email = $2"#,
        organization_id,
        email
    )
    .execute(&mut *transaction)
    .await?;

    sqlx::query!(
        r#"DELETE FROM "OrganizationEmailMatches" WHERE "organizationId" = $1 AND email = $2"#,
        organization_id,
        email
    )
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;
    Ok(())
}
