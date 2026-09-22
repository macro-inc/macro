//! Provider and refresh adapters for email-owned invitation extraction.
use super::email_api::GmailApi;
use email::domain::invitation_extraction::{
    DiscoveredInvitationPart, InvitationAttachmentProvider, InvitationExtractionNotifier,
};
use rootcause::Report;
use uuid::Uuid;

/// Uses the existing provider token and rate-limit service.
#[derive(Clone)]
pub struct InvitationProvider(pub GmailApi);
impl InvitationAttachmentProvider for InvitationProvider {
    async fn discover(
        &self,
        link_id: Uuid,
        message_id: &str,
    ) -> Result<Vec<DiscoveredInvitationPart>, Report> {
        let fetched = self
            .0
            .get_message(link_id, message_id)
            .await
            .map_err(Report::new)?;
        let Some(fetched) = fetched else {
            return Ok(Vec::new());
        };
        Ok(fetched
            .calendar_parts
            .into_iter()
            .take(email::domain::calendar_invitation_parser::MAX_INVITATION_COMPONENTS)
            .map(|part| DiscoveredInvitationPart {
                part_id: part.part_id.unwrap_or_else(|| "calendar".to_owned()),
                attachment_id: part.provider_attachment_id,
                bytes: part.inline_data,
            })
            .collect())
    }
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
/// Completion notification through the same gateway as inbox sync.
#[derive(Clone)]
pub struct InvitationNotifier {
    /// Email domain repository for inbox ownership.
    pub db: sqlx::PgPool,
    /// Existing refresh transport.
    pub gateway: connection_gateway_client::client::ConnectionGatewayClient,
}
impl InvitationExtractionNotifier for InvitationNotifier {
    async fn completed(&self, link_id: Uuid) -> Result<(), Report> {
        if let Some(link) = email_db_client::links::get::fetch_link_by_id(&self.db, link_id)
            .await
            .map_err(|e| rootcause::report!(e.to_string()))?
            && cfg!(feature = "connection_gateway")
        {
            let payload = serde_json::to_value(
                models_email::api::refresh::RefreshEmailEvent::CalendarInvitationsUpdated {
                    link_id,
                },
            )?;
            self.gateway
                .refresh_email(link.macro_id.as_ref(), payload)
                .await
                .map_err(|error| rootcause::report!(error.to_string()))?;
        }
        Ok(())
    }
}
