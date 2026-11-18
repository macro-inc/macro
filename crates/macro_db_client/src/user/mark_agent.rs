#[cfg(test)]
mod test;

/// Marks a just-created account as an agent.
///
/// For identity-provider signups, whose account exists before the sign-in
/// returns. The provider has verified the address, so the flag needs no
/// further proof.
#[tracing::instrument(skip(db), err)]
pub async fn mark_agent(db: &sqlx::PgPool, email: &str) -> anyhow::Result<()> {
    sqlx::query!(
        r#"UPDATE "User" SET "isAgent" = TRUE WHERE "email" = $1"#,
        email,
    )
    .execute(db)
    .await?;

    Ok(())
}
