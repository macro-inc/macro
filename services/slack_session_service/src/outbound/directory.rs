//! Candidate discovery, release announcements and fleet health through the
//! Slack domain; the advisory locks are `session_fleet`'s.

use external_chat::domain::models::ExternalChatError;
use slack_linked::domain::session::SessionService;
use uuid::Uuid;

use session_fleet::ports::{AccountDirectory, FleetHealth, LeaseError};

/// The Slack accounts that need a session.
#[derive(Clone)]
pub struct PgAccountDirectory {
    sessions: SessionService,
}

impl PgAccountDirectory {
    /// Wraps the domain service.
    pub fn new(sessions: SessionService) -> Self {
        Self { sessions }
    }
}

fn domain_error(report: rootcause::Report<ExternalChatError>) -> LeaseError {
    LeaseError::Internal(report.into_dynamic())
}

impl AccountDirectory for PgAccountDirectory {
    async fn candidates(&self, limit: u32) -> Result<Vec<Uuid>, LeaseError> {
        self.sessions
            .discoverable_accounts(i64::from(limit))
            .await
            .map_err(domain_error)
    }

    /// Slack signals always name their account.
    async fn resolve(&self, _key: Uuid) -> Result<Option<Uuid>, LeaseError> {
        Ok(None)
    }

    async fn announce_released(&self, account: Uuid) -> Result<(), LeaseError> {
        self.sessions
            .announce_released(account)
            .await
            .map_err(domain_error)
    }

    async fn health(&self) -> Result<FleetHealth, LeaseError> {
        let (accounts_unowned, oldest_unprocessed_inbound_seconds) =
            self.sessions.fleet_health().await.map_err(domain_error)?;
        Ok(FleetHealth {
            accounts_unowned,
            oldest_unprocessed_inbound_seconds,
        })
    }
}
