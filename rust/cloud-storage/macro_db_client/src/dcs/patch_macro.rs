use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn patch_macro(
    db: &Pool<Postgres>,
    macro_prompt_id: &str,
    title: Option<&str>,
    prompt: Option<&str>,
    icon: Option<&str>,
    color: Option<&str>,
    required_docs: Option<&i32>,
) -> anyhow::Result<()> {
    let mut transaction = db.begin().await?;

    // Update macro updated_at time
    sqlx::query!(
        r#"
        UPDATE "MacroPrompt" SET "updated_at" = NOW()
        WHERE id = $1
        "#,
        macro_prompt_id,
    )
    .execute(&mut *transaction)
    .await?;

    if let Some(title) = title {
        sqlx::query!(
            r#"
            UPDATE "MacroPrompt" SET "title" = $1
            WHERE id = $2
            "#,
            title,
            macro_prompt_id,
        )
        .execute(&mut *transaction)
        .await?;
    }

    if let Some(prompt) = prompt {
        sqlx::query!(
            r#"
            UPDATE "MacroPrompt" SET "prompt" = $1
            WHERE id = $2
            "#,
            prompt,
            macro_prompt_id,
        )
        .execute(&mut *transaction)
        .await?;
    }

    if let Some(icon) = icon {
        sqlx::query!(
            r#"
            UPDATE "MacroPrompt" SET "icon" = $1
            WHERE id = $2
            "#,
            icon,
            macro_prompt_id,
        )
        .execute(&mut *transaction)
        .await?;
    }

    if let Some(color) = color {
        sqlx::query!(
            r#"
            UPDATE "MacroPrompt" SET "color" = $1
            WHERE id = $2
            "#,
            color,
            macro_prompt_id,
        )
        .execute(&mut *transaction)
        .await?;
    }

    if let Some(required_docs) = required_docs {
        sqlx::query!(
            r#"
            UPDATE "MacroPrompt" SET "required_docs" = $1
            WHERE id = $2
            "#,
            required_docs,
            macro_prompt_id,
        )
        .execute(&mut *transaction)
        .await?;
    }

    transaction.commit().await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dcs::get_macro::get_macro;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("macro_example")))]
    async fn test_patch_macro(pool: Pool<Postgres>) -> anyhow::Result<()> {
        patch_macro(
            &pool,
            "prompt-three",
            Some("Updated Title"),
            Some("Updated Prompt"),
            Some("new-icon"),
            Some("blue"),
            Some(&2),
        )
        .await?;

        let macro_item = get_macro(&pool, "prompt-three").await?;

        assert_eq!(macro_item.title, "Updated Title".to_string());
        assert_eq!(macro_item.prompt, "Updated Prompt".to_string());
        assert_eq!(macro_item.icon, "new-icon".to_string());
        assert_eq!(macro_item.color, "blue".to_string());
        assert_eq!(macro_item.required_docs, Some(2));

        Ok(())
    }
}
