use model::macros::{Macro, MacroResponse};
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_macro(
    db: &Pool<Postgres>,
    macro_prompt_id: &str,
) -> anyhow::Result<MacroResponse, sqlx::Error> {
    let macro_item = sqlx::query_as!(
        Macro,
        r#"
            SELECT
                t.id,
                t.user_id,
                t.title,
                t.prompt,
                t.icon,
                t.color,
                t.required_docs,
                t.created_at::timestamptz,
                t.updated_at::timestamptz
            FROM "MacroPrompt" t
            WHERE t.id = $1
            "#,
        macro_prompt_id,
    )
    .fetch_one(db)
    .await?;

    let response: MacroResponse = macro_item.into();
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("macro_example")))]
    async fn test_get_macro(pool: Pool<Postgres>) {
        let macro_item = get_macro(&pool, "prompt-three").await.unwrap();

        assert_eq!(macro_item.id, "prompt-three".to_string());
        assert_eq!(macro_item.user_id, "macro|user@user.com".to_string());
        assert_eq!(macro_item.title, "Test Prompt 3".to_string());
        assert_eq!(macro_item.prompt, "This is a test prompt 3".to_string());
        assert_eq!(macro_item.icon, "icon3".to_string());
        assert_eq!(macro_item.color, "green".to_string());
        assert_eq!(macro_item.required_docs, Some(1));
    }
}
