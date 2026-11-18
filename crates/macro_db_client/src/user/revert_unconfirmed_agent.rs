#[cfg(test)]
mod test;

/// Reverts an account to human when its agent flag was never proven.
///
/// Signup creates the account before the email is verified, so a request can
/// mark someone else's unused address as an agent. The flag stands once the
/// account has confirmed setup, holds a key (minting one takes a verified
/// session), or has a pending agent invite from a team member.
///
/// Returns whether the account was reverted.
#[tracing::instrument(skip(db), err)]
pub async fn revert_unconfirmed_agent(db: &sqlx::PgPool, email: &str) -> anyhow::Result<bool> {
    let result = sqlx::query!(
        r#"
        UPDATE "User" u
        SET "isAgent" = FALSE
        WHERE u."email" = $1
          AND u."isAgent"
          AND NOT u."tutorialComplete"
          AND NOT EXISTS (SELECT 1 FROM "UserApiKey" k WHERE k.user_id = u."id")
          AND NOT EXISTS (
              SELECT 1 FROM team_invite ti WHERE ti.email = u."email" AND ti.is_agent
          )
        "#,
        email,
    )
    .execute(db)
    .await?;

    Ok(result.rows_affected() > 0)
}
