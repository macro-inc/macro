use models_permissions::share_permission::SharePermissionV2;

use crate::share_permission::create::create_macro_permission;

#[tracing::instrument(skip(db))]
#[expect(clippy::too_many_arguments, reason = "too annoying to fix")]
pub async fn create_macro(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    title: &str,
    prompt: &str,
    icon: &str,
    color: &str,
    required_docs: Option<i32>,
    share_permission: &SharePermissionV2,
) -> anyhow::Result<String> {
    let mut transaction = db.begin().await?;

    let macro_item = sqlx::query!(
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
    .map(|row| row.id)
    .fetch_one(&mut *transaction)
    .await?;

    create_macro_permission(&mut transaction, &macro_item, share_permission).await?;

    transaction.commit().await.map_err(|e| {
        tracing::error!(error=?e, "create_macro transaction error");
        anyhow::Error::from(e)
    })?;

    Ok(macro_item)
}
