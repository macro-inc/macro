use anyhow::{Context, Result};
use sqlx::{PgPool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_onboarding_status(db: &PgPool, user_id: &str) -> Result<bool> {
    let result = sqlx::query!(
        r#"
        SELECT "hasOnboardingDocuments"::boolean
        FROM "User"
        WHERE id = $1
        "#,
        user_id
    )
    .fetch_one(db)
    .await
    .context("Failed to fetch onboarding status")?;
    Ok(result.hasOnboardingDocuments)
}

#[tracing::instrument(skip(transaction))]
pub async fn set_onboarding_status(
    transaction: &mut sqlx::Transaction<'_, Postgres>,
    user_id: &str,
) -> Result<()> {
    sqlx::query!(
        r#"
        UPDATE "User"
        SET "hasOnboardingDocuments" = $1
        WHERE id = $2
        "#,
        true,
        user_id
    )
    .execute(transaction.as_mut())
    .await
    .context("Failed to set onboarding status")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("users")))]
    async fn test_get_onboarding_status(pool: Pool<Postgres>) {
        let is_onboarded1 = get_onboarding_status(&pool, "macro|user@user.com")
            .await
            .unwrap();
        let is_onboarded2 = get_onboarding_status(&pool, "macro|user2@user.com")
            .await
            .unwrap();
        assert!(!is_onboarded1);
        assert!(is_onboarded2);
    }
}
