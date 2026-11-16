//! Connects Gmail or delegates a verified mailbox grant without changing legacy partial writes.

mod gmail;
mod grants;
mod models;
mod ports;
mod shared;
#[cfg(test)]
mod test;

pub use models::*;
pub use ports::*;

use super::initialization::{
    CompletedMailboxGrantSource, InitializationError, InitializeMailbox,
    MailboxInitializationRepository, MailboxInitializationService,
};
use std::sync::Arc;

pub struct InboxConnectionService<L, T, P, G, I, B, N, O> {
    pub links: L,
    pub transactions: T,
    pub provider: P,
    pub grants: G,
    pub initializer: Arc<I>,
    pub backfill: B,
    pub identity: N,
    pub failure_observer: O,
}

impl<L, T, P, G, I, B, N, O> InboxConnectionService<L, T, P, G, I, B, N, O>
where
    L: ConnectionLinks,
    T: ConnectionTransactions,
    P: ConnectionProvider,
    G: ConnectionGrants,
    I: ConnectionInitializer,
    B: ConnectionBackfill,
    N: ConnectionIdentity,
    O: ConnectionFailureObserver,
{
    pub async fn connect(
        &self,
        request: ConnectionRequest,
    ) -> Result<ConnectionOutcome, ConnectionError> {
        if let Some(attempt) = request.attempt {
            let mailbox = InitializeMailbox {
                attempt,
                actor: request.actor_macro_id.clone(),
                actor_fusion_id: request
                    .actor_fusion_id
                    .parse()
                    .map_err(|_| ConnectionError::InvalidUserIdentity)?,
                force_share: request.force_share,
            };
            if self
                .initializer
                .recognizes(&mailbox)
                .await
                .map_err(ConnectionError::MailboxInitialization)?
            {
                return match self.initializer.initialize(mailbox).await {
                    Ok(link_id) => Ok(ConnectionOutcome {
                        link_id,
                        backfill_job_id: None,
                    }),
                    Err(InitializationError::SharingConfirmation {
                        link_id,
                        email,
                        owner_email,
                    }) => Err(ConnectionError::SharedInboxConflict {
                        email_address: email,
                        existing_owner_email: owner_email,
                        existing_link_id: link_id,
                    }),
                    Err(error) => Err(ConnectionError::MailboxInitialization(error)),
                };
            }
        }
        let result = gmail::connect(self, &request).await;
        if let Err(error) = &result {
            self.failure_observer.observe_failure(&request, error);
            if let Some(attempt) = request.attempt
                && error.should_cleanup_attempt()
            {
                self.links
                    .cleanup_attempt(attempt, &request.actor_fusion_id)
                    .await;
            }
        }
        result
    }
}

impl<R: MailboxInitializationRepository, G: CompletedMailboxGrantSource> ConnectionInitializer
    for MailboxInitializationService<R, G>
{
    async fn recognizes(&self, request: &InitializeMailbox) -> Result<bool, InitializationError> {
        MailboxInitializationService::recognizes(self, request).await
    }

    async fn initialize(
        &self,
        request: InitializeMailbox,
    ) -> Result<uuid::Uuid, InitializationError> {
        MailboxInitializationService::initialize(self, request).await
    }
}

fn database(error: impl ConnectionSourceError, context: &'static str) -> ConnectionError {
    ConnectionError::DatabaseError(error.into_original().context(context))
}
