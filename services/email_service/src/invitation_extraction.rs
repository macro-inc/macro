//! Composition and polling lifecycle for durable invitation extraction.
use crate::outbound::invitation_extraction::{InvitationNotifier, InvitationProvider};
use email::domain::invitation_extraction::InvitationExtractionService;
use email::outbound::invitation_pg::InvitationPgRepository;

/// Worker composition of the email-owned extraction service.
pub type EmailInvitationExtractor =
    InvitationExtractionService<InvitationPgRepository, InvitationProvider, InvitationNotifier>;

/// Compose infrastructure once at worker startup.
pub fn compose(
    db: sqlx::PgPool,
    provider: crate::outbound::email_api::GmailApi,
    gateway: connection_gateway_client::client::ConnectionGatewayClient,
) -> EmailInvitationExtractor {
    InvitationExtractionService {
        repository: InvitationPgRepository(db.clone()),
        provider: InvitationProvider(provider),
        notifier: InvitationNotifier { db, gateway },
    }
}
/// Retry leased jobs until shutdown; failed parts remain durable.
pub async fn run(
    service: EmailInvitationExtractor,
    cancellation: tokio_util::sync::CancellationToken,
) {
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(30));
    loop {
        tokio::select! {
            _ = cancellation.cancelled() => return,
            _ = interval.tick() => { service.run_once().await.inspect_err(|error| tracing::error!(error=?error, "invitation extraction batch failed")).ok(); }
        }
    }
}
