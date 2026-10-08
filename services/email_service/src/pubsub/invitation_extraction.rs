//! Translate provider MIME parts into the email extraction use case.
use super::context::PubSubContext;
use crate::outbound::{email_api::GmailApi, invitation_extraction::InvitationProvider};
use email::domain::invitation_extraction::{InvitationExtractionService, InvitationPart};
use email::outbound::invitation_pg::InvitationPgRepository;
use email_api_client::domain::models::CalendarPart;
use uuid::Uuid;

/// Worker composition of the email-owned extraction service.
pub type EmailInvitationExtractor =
    InvitationExtractionService<InvitationPgRepository, InvitationProvider>;

/// Compose infrastructure once at worker startup.
pub fn compose(db: sqlx::PgPool, provider: GmailApi) -> EmailInvitationExtractor {
    InvitationExtractionService {
        repository: InvitationPgRepository(db),
        provider: InvitationProvider(provider),
    }
}

/// Save invitation snapshots after the email commit. Failures leave plain mail.
pub async fn save_discovered(
    ctx: &PubSubContext,
    link_id: Uuid,
    provider_id: &str,
    message_id: Uuid,
    parts: &[CalendarPart],
) {
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
    if let Err(error) = ctx
        .invitation_extractor
        .ingest(message_id, link_id, provider_id, &parts)
        .await
    {
        tracing::warn!(error=?error, "invitation extraction failed");
    }
}
