//! Candidate discovery, pairing lookups and release announcements through the
//! linked-devices domain; the advisory locks are `session_fleet`'s.

use uuid::Uuid;

use external_chat::domain::models::ExternalChatError;
use whatsapp_linked::domain::session::SessionService;

use crate::domain::ports::{AccountDirectory, FleetHealth, LeaseError};

#[cfg(test)]
mod test;

/// Discovery and release announcements through the linked-devices domain.
#[derive(Clone)]
pub struct PgAccountDirectory {
    sessions: SessionService,
}

impl PgAccountDirectory {
    /// Wraps the domain service.
    pub fn new(sessions: SessionService) -> Self {
        PgAccountDirectory { sessions }
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

    async fn resolve(&self, pairing: Uuid) -> Result<Option<Uuid>, LeaseError> {
        Ok(self
            .sessions
            .pairing_work(pairing)
            .await
            .map_err(domain_error)?
            .map(|work| work.account_id))
    }

    async fn announce_released(&self, account: Uuid) -> Result<(), LeaseError> {
        self.sessions
            .announce_released(account)
            .await
            .map_err(domain_error)
    }

    async fn health(&self) -> Result<FleetHealth, LeaseError> {
        let health = self.sessions.fleet_health().await.map_err(domain_error)?;
        Ok(FleetHealth {
            accounts_unowned: health.accounts_unowned,
            oldest_unprocessed_inbound_seconds: health.oldest_unprocessed_inbound_seconds,
        })
    }
}
