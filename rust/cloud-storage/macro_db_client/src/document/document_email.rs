use uuid::Uuid;

/// create record in document_email table, linking the document (an email attachment) and email message
pub async fn create_document_email_record(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: &str,
    email_attachment_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            INSERT INTO "document_email" (document_id, email_attachment_id)
            VALUES ($1, $2) 
        "#,
        document_id,
        email_attachment_id,
    )
    .execute(&mut **transaction)
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to create document email record");
        anyhow::anyhow!("unable to create document email record: {}", err)
    })?;

    Ok(())
}
