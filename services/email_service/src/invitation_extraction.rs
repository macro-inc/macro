//! Composition for email-owned invitation extraction.
use crate::outbound::invitation_extraction::InvitationProvider;
use email::domain::invitation_extraction::InvitationExtractionService;
use email::outbound::invitation_pg::InvitationPgRepository;

/// Worker composition of the email-owned extraction service.
pub type EmailInvitationExtractor =
    InvitationExtractionService<InvitationPgRepository, InvitationProvider>;

/// Compose infrastructure once at worker startup.
pub fn compose(
    db: sqlx::PgPool,
    provider: crate::outbound::email_api::GmailApi,
) -> EmailInvitationExtractor {
    InvitationExtractionService {
        repository: InvitationPgRepository(db),
        provider: InvitationProvider(provider),
    }
}
