use model::macros::Macro;
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_macros(db: &Pool<Postgres>, user_id: &str) -> anyhow::Result<Vec<Macro>> {
    let mut macros: Vec<Macro> = Vec::new();
    macros.extend(
        sqlx::query_as!(
            Macro,
            r#"
            SELECT
                t.id,
                t.title,
                t.prompt,
                t.icon,
                t.color,
                t.required_docs,
                t.user_id,
                t.created_at::timestamptz,
                t.updated_at::timestamptz
            FROM "MacroPrompt" t
            WHERE t.user_id = $1
            "#,
            user_id,
        )
        .fetch_all(db)
        .await?,
    );

    Ok(macros)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("macro_example")))]
    async fn test_get_macros(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let macros = get_macros(&pool, "macro|user2@user.com").await?;
        assert_eq!(macros.len(), 2);
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("macro_example")))]
    async fn test_get_macros_with_document_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let macros = get_macros(&pool, "macro|user@user.com").await?;
        assert_eq!(macros.len(), 3);
        Ok(())
    }
}
