use macro_user_id::user_id::MacroUserIdStr;

/// Check if email link exists for user
#[tracing::instrument(skip(db))]
pub async fn check_user_email_link(
    db: &sqlx::Pool<sqlx::Postgres>,
    macro_user_id: &MacroUserIdStr<'static>,
) -> anyhow::Result<bool> {
    let link_id = sqlx::query!(
        r#"
    SELECT id FROM email_links
    WHERE macro_id = $1
    "#,
        macro_user_id.as_ref()
    )
    .map(|row| row.id)
    .fetch_optional(db)
    .await?;

    Ok(link_id.is_some())
}
