use sqlx::PgPool;
use sqlx::types::Uuid;

#[cfg(test)]
mod test;

/// Committed effects of deleting an email link.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeleteLinkOutcome {
    /// Number of deleted link rows (zero or one).
    pub rows_affected: u64,
    /// Documents whose `document_email` relation was cascade-removed.
    pub detached_document_ids: Vec<String>,
}

/// Deletes a link and atomically snapshots projection-relevant relation removals.
///
/// The caller must publish document relation-change events only after this
/// function commits successfully.
#[tracing::instrument(skip(pool), err)]
pub async fn delete_link_by_id(pool: &PgPool, link_id: Uuid) -> anyhow::Result<DeleteLinkOutcome> {
    let mut tx = pool.begin().await?;
    let mut detached_document_ids = sqlx::query_scalar!(
        r#"
        SELECT de.document_id
        FROM document_email de
        INNER JOIN email_attachments ea ON ea.id = de.email_attachment_id
        INNER JOIN email_messages em ON em.id = ea.message_id
        WHERE em.link_id = $1
        "#,
        link_id
    )
    .fetch_all(&mut *tx)
    .await?;
    detached_document_ids.sort();
    detached_document_ids.dedup();

    let result = sqlx::query!(
        r#"
        DELETE FROM email_links
        WHERE id = $1
        "#,
        link_id
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;

    Ok(DeleteLinkOutcome {
        rows_affected: result.rows_affected(),
        detached_document_ids,
    })
}
