use sqlx::PgPool;
use sqlx::types::Uuid;

/// Deletes a link by its ID.
/// Will cascade to delete threads, messages, attachments, and labels for the user.
/// Returns document ids whose last `document_email` row cascaded away.
#[tracing::instrument(skip(pool), err)]
pub async fn delete_link_by_id(pool: &PgPool, link_id: Uuid) -> anyhow::Result<Vec<String>> {
    let unlinked =
        crate::attachments::document_email::documents_losing_last_email_attachment_for_links(
            pool,
            &[link_id],
        )
        .await?;

    sqlx::query!(
        r#"
        DELETE FROM email_links
        WHERE id = $1
        "#,
        link_id
    )
    .execute(pool)
    .await?;

    Ok(unlinked)
}
