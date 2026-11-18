//! Existing inbox connection persistence and provider calls behind domain ports.

mod backfill;
pub(crate) mod grants;
mod links;
mod provider;
mod transactions;

pub use backfill::*;
pub use grants::GoogleConnectionGrants;
pub use links::PgConnectionLinks;
pub use provider::GoogleConnectionProvider;
pub use transactions::PgConnectionTransactions;

use super::persistence_error::InboxPersistenceError;
use email::domain::mailbox::connection::*;
use models_email::service::link::Link;
use uuid::Uuid;

impl ConnectionSourceError for InboxPersistenceError {
    fn into_original(self) -> anyhow::Error {
        self.into_inner()
    }
}

pub struct LoginEmailIdentity;

impl ConnectionIdentity for LoginEmailIdentity {
    fn login_email(&self, user: &str) -> Result<String, ConnectionError> {
        extract_email_with_response(user)
    }
}

// Keep the legacy span while returning only the domain refusal to this adapter.
#[tracing::instrument(level = "debug")]
fn extract_email_with_response(user_id: &str) -> Result<String, ConnectionError> {
    crate::utils::email_from_user_id(user_id).map_err(|e| {
        tracing::error!(error=?e, "unable to get email from user id");
        ConnectionError::LoginEmailUnavailable
    })
}
