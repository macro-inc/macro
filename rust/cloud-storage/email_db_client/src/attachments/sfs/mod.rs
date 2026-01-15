use models_email::{db, service};
use sqlx::{Executor, Postgres};

/// Inserts an attachment SFS record into the database
#[tracing::instrument(skip(executor), err)]
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
    .await?;

    Ok(())
}

/// Deletes an attachment SFS record from the database by its ID
#[tracing::instrument(skip(executor), err)]
pub async fn delete_attachment_sfs<'e, E>(executor: E, id: sqlx::types::Uuid) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query!(
        r#"
        DELETE FROM email_attachments_sfs
        WHERE id = $1
        "#,
        id,
    )
    .execute(executor)
    .await?;

    Ok(())
}
