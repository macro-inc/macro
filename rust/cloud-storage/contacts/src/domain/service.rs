use crate::domain::models::messages::ContactsMessage;
use crate::domain::models::user::Group;
use crate::domain::ports::{ContactsNotifier, ContactsRepository};
use macro_user_id::user_id::MacroUserIdStr;

use tracing::instrument;

/// Domain service combining a repository and notifier to manage contacts.
pub struct ContactsDomainService<R, N> {
    /// The contacts repository for data persistence.
    pub repository: R,
    /// The notifier for real-time contact invalidation.
    pub notifier: N,
}

impl<R: ContactsRepository, N: ContactsNotifier> ContactsDomainService<R, N> {
    /// Queries a user's contacts from the repository.
    pub async fn query_contacts(&self, user_id: &str) -> Option<Vec<String>> {
        self.repository
            .get_contacts(user_id)
            .await
            .inspect_err(|e| tracing::error!(error=?e, user_id=%user_id, "failed to get contacts"))
            .ok()
    }

    /// Adds a single contact connection between two users.
    pub async fn add_contact(&self, caller: &str, recipient: &str) -> Result<(), anyhow::Error> {
        let a = MacroUserIdStr::try_from(caller.to_owned())?;
        let b = MacroUserIdStr::try_from(recipient.to_owned())?;
        self.repository.create_connections(vec![(a, b)]).await
    }

    /// Processes a contacts SQS message by computing all pairwise connections
    /// from the user list and persisting them.
    #[instrument(skip(self))]
    pub async fn process_message(&self, msg: &ContactsMessage) {
        let connections = Group::new(&msg.users).generate();

        if connections.is_empty() {
            return;
        }

        if self.repository.create_connections(connections).await.is_err() {
            return;
        }

        self.notifier
            .invalidate_contacts_for_users(&msg.users)
            .await
            .inspect_err(|e| tracing::error!(error=?e, "failed to invalidate contacts"))
            .ok();
    }
}

#[cfg(test)]
mod test;
