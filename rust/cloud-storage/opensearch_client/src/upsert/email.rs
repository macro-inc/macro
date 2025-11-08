use crate::{EMAIL_INDEX, Result, date_format::EpochSeconds, error::OpensearchClientError};

/// The arguments for upserting an email message into the opensearch index
#[derive(Debug, serde::Serialize)]
pub struct UpsertEmailArgs {
    /// The id of the email thread
    pub thread_id: String,
    /// The id of the email message
    pub message_id: String,
    /// The sender of the email message
    pub sender: String,
    /// The recipients of the email message
    pub recipients: Vec<String>,
    /// The cc of the email message
    pub cc: Vec<String>,
    /// The bcc of the email message
    pub bcc: Vec<String>,
    /// The labels of the email message
    pub labels: Vec<String>,
    /// The link id of the email message
    pub link_id: String,
    /// The user id of the email message
    pub user_id: String,
    /// The updated at time of the email message
    pub updated_at_seconds: EpochSeconds,
    /// The subject of the email message
    pub subject: Option<String>,
    /// The sent at time of the email message
    pub sent_at_seconds: Option<EpochSeconds>,
    /// The content of the email message
    pub content: String,
}

#[tracing::instrument(skip(client))]
pub(crate) async fn upsert_email_message(
    client: &opensearch::OpenSearch,
    args: &UpsertEmailArgs,
) -> Result<()> {
    let id = format!("{}:{}", args.thread_id, args.message_id);
    let response = client
        .index(opensearch::IndexParts::IndexId(EMAIL_INDEX, &id))
        .body(args)
        .send()
        .await
        .map_err(|err| OpensearchClientError::DeserializationFailed {
            details: err.to_string(),
            method: Some("upsert_email_message".to_string()),
        })?;

    let status_code = response.status_code();
    if status_code.is_success() {
        tracing::trace!(id=%id, "email message upserted successfully");
    } else {
        let body =
            response
                .text()
                .await
                .map_err(|err| OpensearchClientError::DeserializationFailed {
                    details: err.to_string(),
                    method: Some("upsert_email_message".to_string()),
                })?;

        tracing::error!(
            status_code=%status_code,
            body=%body,
            "error upserting email message",
        );

        return Err(OpensearchClientError::Unknown {
            details: body,
            method: Some("upsert_email_message".to_string()),
        });
    }
    Ok(())
}
