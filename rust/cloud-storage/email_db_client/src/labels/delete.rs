use anyhow::{Context, anyhow};
use sqlx::types::Uuid;
use sqlx::{Executor, PgPool, Postgres};

/// Deletes a label from multiple messages at once
/// Returns the number of message-label associations that were deleted
#[tracing::instrument(skip(executor), level = "info")]
pub async fn delete_message_labels_batch<'e, E>(
    executor: E,
    message_ids: &Vec<Uuid>,
    provider_label_id: &str,
    link_id: Uuid,
) -> anyhow::Result<usize>
where
    E: Executor<'e, Database = Postgres>,
{
    if message_ids.is_empty() {
        return Ok(0);
    }

    if provider_label_id.is_empty() {
        return Err(anyhow!("Provider label ID cannot be empty"));
    }

    let result = sqlx::query!(
        r#"
        DELETE FROM email_message_labels
        WHERE 
            message_id = ANY($1) 
            AND label_id = (
                SELECT id FROM email_labels
                WHERE link_id = $2 AND provider_label_id = $3
            )
        "#,
        message_ids,
        link_id,
        provider_label_id
    )
        .execute(executor)
        .await
        .with_context(|| {
            format!(
                "Failed to delete message_labels for {} messages with provider_label_id {} and link_id {}",
                message_ids.len(), provider_label_id, link_id
            )
        })?;

    let rows_affected = result.rows_affected() as usize;

    Ok(rows_affected)
}

// delete all the message labels for a message.
#[tracing::instrument(skip(executor), level = "info")]
pub async fn delete_all_message_labels<'e, E>(executor: E, message_id: Uuid) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query!(
        r#"
        DELETE FROM email_message_labels
        WHERE message_id = $1
        "#,
        message_id
    )
    .execute(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to delete message_labels for message_id {}",
            message_id
        )
    })?;

    Ok(())
}

/// delete one or more message labels
#[tracing::instrument(skip(tx), level = "info")]
pub async fn delete_db_message_labels(
    tx: &mut sqlx::PgConnection,
    message_id: Uuid,
    provider_label_ids: &[String],
    link_id: Uuid,
) -> anyhow::Result<()> {
    if provider_label_ids.is_empty() {
        return Ok(());
    }

    sqlx::query!(
        r#"
        DELETE FROM email_message_labels
        WHERE message_id = $1
        AND label_id IN (
            SELECT id FROM email_labels
            WHERE link_id = $2 AND provider_label_id = ANY($3)
        )
        "#,
        message_id,
        link_id,
        &provider_label_ids
    )
        .execute(tx)
        .await
        .with_context(|| {
            format!(
                "Failed to delete message_labels for message_id {} with provider_label_ids {:?} and link_id {}",
                message_id, provider_label_ids, link_id
            )
        })?;

    Ok(())
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn delete_labels_by_provider_ids(
    pool: &PgPool,
    link_id: Uuid,
    provider_label_ids: Vec<String>,
) -> anyhow::Result<u64> {
    if provider_label_ids.is_empty() {
        return Ok(0);
    }

    // First, delete any message_labels entries that reference these labels to avoid foreign key issues
    let deleted_message_labels = sqlx::query!(
        r#"
        DELETE FROM email_message_labels
        WHERE label_id IN (
            SELECT id FROM email_labels
            WHERE link_id = $1 AND provider_label_id = ANY($2)
        )
        "#,
        link_id,
        &provider_label_ids
    )
        .execute(pool)
        .await
        .with_context(|| format!(
            "Failed to delete message_labels referencing labels with link_id {} and provider_label_ids {:?}",
            link_id, provider_label_ids
        ))?;

    tracing::debug!(
        link_id = %link_id,
        provider_label_count = provider_label_ids.len(),
        deleted_message_labels_count = deleted_message_labels.rows_affected(),
        "Deleted message_labels entries that referenced the labels"
    );

    // Now delete the labels themselves
    let result = sqlx::query!(
        r#"
        DELETE FROM email_labels
        WHERE link_id = $1 AND provider_label_id = ANY($2)
        "#,
        link_id,
        &provider_label_ids
    )
    .execute(pool)
    .await
    .with_context(|| {
        format!(
            "Failed to delete labels with link_id {} and provider_label_ids {:?}",
            link_id, provider_label_ids
        )
    })?;

    let rows_affected = result.rows_affected();

    Ok(rows_affected)
}

#[tracing::instrument(skip(pool), level = "info")]
pub async fn delete_label_by_id(
    pool: &PgPool,
    label_id: Uuid,
    link_id: Uuid,
) -> anyhow::Result<bool> {
    // Begin a transaction since we need to delete from multiple tables
    let mut tx = pool
        .begin()
        .await
        .context("Failed to begin transaction for label deletion")?;

    // First, delete any message_labels entries that reference this label to avoid foreign key issues
    let deleted_message_labels = sqlx::query!(
        r#"
        DELETE FROM email_message_labels
        WHERE label_id = $1
        "#,
        label_id
    )
    .execute(&mut *tx)
    .await
    .with_context(|| {
        format!(
            "Failed to delete message_labels referencing label with id {} and link_id {}",
            label_id, link_id
        )
    })?;

    tracing::debug!(
        label_id = %label_id,
        link_id = %link_id,
        deleted_message_labels_count = deleted_message_labels.rows_affected(),
        "Deleted message_labels entries that referenced the label"
    );

    // Now delete the label itself, making sure it belongs to the specified link
    let result = sqlx::query!(
        r#"
        DELETE FROM email_labels
        WHERE id = $1 AND link_id = $2
        "#,
        label_id,
        link_id
    )
    .execute(&mut *tx)
    .await
    .with_context(|| {
        format!(
            "Failed to delete label with id {} and link_id {}",
            label_id, link_id
        )
    })?;

    let rows_affected = result.rows_affected();
    let label_found = rows_affected > 0;

    // Commit the transaction
    tx.commit()
        .await
        .context("Failed to commit transaction for label deletion")?;

    Ok(label_found)
}
