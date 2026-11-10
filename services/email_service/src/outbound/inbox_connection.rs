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
        crate::utils::extract_email_with_response(user)
            .map_err(|_| ConnectionError::LoginEmailUnavailable)
    }
}
