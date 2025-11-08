/// Merges to_merge_macro_user_id into macro_user_id
/// This transaction is not committed and will need to be manually committed by the caller
#[tracing::instrument(skip(transaction))]
pub async fn merge_accounts(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    macro_user_id: &str,
    to_merge_macro_user_id: &str,
) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::string_to_uuid(macro_user_id)?;
    let to_merge_macro_user_id = macro_uuid::string_to_uuid(to_merge_macro_user_id)?;

    // Update the user profiles to point to the new macro user id
    sqlx::query!(
        r#"
        UPDATE "User" SET "macro_user_id" = $1 WHERE "macro_user_id" = $2
        "#,
        &macro_user_id,
        &to_merge_macro_user_id
    )
    .execute(transaction.as_mut())
    .await?;

    // Update macro_user_email_verification
    sqlx::query!(
        r#"
        UPDATE "macro_user_email_verification" SET "macro_user_id" = $1 WHERE "macro_user_id" = $2
        "#,
        &macro_user_id,
        &to_merge_macro_user_id
    )
    .execute(transaction.as_mut())
    .await?;

    // Delete the old macro user
    sqlx::query!(
        r#"
        DELETE FROM "macro_user" WHERE "id" = $1
        "#,
        &to_merge_macro_user_id
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("account_merge_request")))]
    async fn test_merge_accounts(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        merge_accounts(
            &mut transaction,
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
        )
        .await?;

        transaction.commit().await?;

        // User should be moved
        let result = sqlx::query!(
            r#"
            SELECT "macro_user_id" as "macro_user_id!" FROM "User" WHERE "macro_user_id" = $1 AND "id" = $2
            "#,
            macro_uuid::string_to_uuid("11111111-1111-1111-1111-111111111111")?,
            "macro|test2@macro.com",
        )
        .map(|row| row.macro_user_id)
        .fetch_one(&pool)
        .await?;

        assert_eq!(
            result.to_string(),
            "11111111-1111-1111-1111-111111111111".to_string()
        );

        Ok(())
    }
}
