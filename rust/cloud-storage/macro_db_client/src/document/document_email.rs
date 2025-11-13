use uuid::Uuid;

// create record in DocumentEmail table, linking the document (an email attachment) and email message
pub async fn create_document_email_record(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    document_id: &str,
    email_message_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
            INSERT INTO "DocumentEmail" (document_id, email_message_id)
            VALUES ($1, $2)
        "#,
        document_id,
        email_message_id,
    )
    .execute(&mut **transaction)
    .await
    .map_err(|err| {
        tracing::error!(error=?err, "unable to create document email record");
        anyhow::anyhow!("unable to create document email record: {}", err)
    })?;

    Ok(())
}
