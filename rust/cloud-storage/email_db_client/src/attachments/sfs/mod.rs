use anyhow::Context;
use models_email::{db, service};
use sqlx::{Executor, Postgres};

/// Inserts an attachment SFS record into the database
#[tracing::instrument(skip(executor))]
pub async fn insert_attachment_sfs<'e, E>(
    executor: E,
    attachment_sfs: &service::attachment::AttachmentSfs,
) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    let db_attachment_sfs: db::attachment::AttachmentSfs = attachment_sfs.clone().into();

    sqlx::query!(
        r#"
        INSERT INTO email_attachments_sfs (id, attachment_id, sfs_id)
        VALUES ($1, $2, $3)
        "#,
        db_attachment_sfs.id,
        db_attachment_sfs.attachment_id,
        db_attachment_sfs.sfs_id,
    )
    .execute(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to insert attachment SFS record with id {}",
            attachment_sfs.id
        )
    })?;

    Ok(())
}
