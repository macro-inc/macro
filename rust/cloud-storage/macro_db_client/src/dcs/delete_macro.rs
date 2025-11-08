#[tracing::instrument(skip(db))]
pub async fn delete_macro(db: &sqlx::PgPool, macro_prompt_id: &str) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;

    // Get share permission if present
    let share_permission: Option<String> = sqlx::query!(
        r#"
            SELECT "share_permission_id"
            FROM "MacroPromptPermission"
            WHERE "macro_prompt_id"=$1"#,
        macro_prompt_id
    )
    .map(|row| row.share_permission_id)
    .fetch_optional(&mut *transaction)
    .await?;

    // Delete share permission
    if let Some(share_permission) = share_permission {
        sqlx::query!(
            r#"
            DELETE FROM "SharePermission" WHERE id = $1"#,
            share_permission
        )
        .execute(&mut *transaction)
        .await?;
    }

    // Delete the macro prompt
    sqlx::query!(
        r#"
        DELETE FROM "MacroPrompt"
        WHERE id = $1"#,
        macro_prompt_id
    )
    .execute(&mut *transaction)
    .await?;

    transaction.commit().await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("macro_example")))]
    async fn test_delete_macro(pool: Pool<Postgres>) -> anyhow::Result<()> {
        delete_macro(&pool, "prompt-three").await?;
        let macro_prompt = sqlx::query!(
            r#"
            SELECT id
            FROM "MacroPrompt"
            WHERE id = $1
            "#,
            "prompt-three"
        )
        .fetch_one(&pool)
        .await;

        assert!(macro_prompt.is_err());
        Ok(())
    }
}
