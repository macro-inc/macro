//! Provider adapter for email-owned invitation extraction.
use super::email_api::GmailApi;
use email::domain::invitation_extraction::InvitationAttachmentProvider;
use rootcause::Report;
use uuid::Uuid;

/// Uses the existing provider token and rate-limit service.
#[derive(Clone)]
pub struct InvitationProvider(pub GmailApi);
impl InvitationAttachmentProvider for InvitationProvider {
    async fn download(
        &self,
        link_id: Uuid,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<Vec<u8>, Report> {
        Ok(self
            .0
            .get_attachment(link_id, message_id, attachment_id)
            .await
            .map_err(Report::new)?)
    }
}

/// Save invitation snapshots after the email commit. Failures leave plain mail.
pub async fn save_discovered<R, P>(
    extractor: &email::domain::invitation_extraction::InvitationExtractionService<R, P>,
    link_id: Uuid,
    provider_id: &str,
    message_id: Uuid,
    parts: &[email_api_client::domain::models::CalendarPart],
) where
    R: email::domain::invitation_extraction::InvitationExtractionRepository,
    P: InvitationAttachmentProvider,
{
    use email::domain::invitation_extraction::InvitationPart;
    let parts = parts
        .iter()
        .filter_map(
            |part| match (&part.inline_data, &part.provider_attachment_id) {
                (Some(bytes), _) => Some(InvitationPart::Inline(bytes)),
                (None, Some(attachment_id)) => Some(InvitationPart::Attachment(attachment_id)),
                (None, None) => None,
            },
        )
        .collect::<Vec<_>>();
    if let Err(error) = extractor
        .ingest(message_id, link_id, provider_id, &parts)
        .await
    {
        tracing::warn!(target: "email_service::pubsub::invitation_extraction", error=?error, "invitation extraction failed");
    }
}
