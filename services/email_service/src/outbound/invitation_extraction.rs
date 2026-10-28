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
