use crate::share_permission::create::create_macro_permission;
use model::StringID;
use models_permissions::share_permission::SharePermissionV2;
use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
#[expect(clippy::too_many_arguments, reason = "too annoying to fix")]
pub async fn create_macro(
    db: Pool<Postgres>,
    user_id: &str,
    title: &str,
    prompt: &str,
    icon: &str,
    color: &str,
    required_docs: Option<i32>,
    share_permission: SharePermissionV2,
) -> anyhow::Result<String> {
    let mut transaction = db.begin().await?;

    let macro_item = sqlx::query_as!(
        StringID,
        r#"
                INSERT INTO "MacroPrompt" (user_id, title,  prompt, icon, color, required_docs)
                VALUES ($1, $2, $3, $4, $5, $6)
                RETURNING id;
            "#,
        &user_id,
        &title,
        &prompt,
        &icon,
        &color,
        required_docs,
    )
    .fetch_one(&mut *transaction)
    .await?;

    create_macro_permission(&mut transaction, macro_item.id.as_str(), &share_permission).await?;

    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "create_macro transaction error");
        anyhow::Error::from(e)
    })?;

    Ok(macro_item.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    use crate::dcs::get_macro::get_macro;

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("dcs_basic_user_with_documents")))]
    async fn test_create_macro(pool: Pool<Postgres>) {
        let macro_prompt_id = create_macro(
            pool.clone(),
            "macro|user@user.com",
            "test macro title",
            "test macro prompt",
            "icon",
            "red",
            Some(3),
            SharePermissionV2::default(),
        )
        .await
        .unwrap();

        assert_eq!(macro_prompt_id.is_empty(), false);
        let macro_item = get_macro(&pool, macro_prompt_id.as_str()).await.unwrap();

        assert_eq!(macro_item.id, macro_prompt_id);
        assert_eq!(macro_item.user_id, "macro|user@user.com".to_string());
        assert_eq!(macro_item.title, "test macro title".to_string());
        assert_eq!(macro_item.prompt, "test macro prompt".to_string());
        assert_eq!(macro_item.color, "red".to_string());
        assert_eq!(macro_item.required_docs, Some(3));
    }
}
