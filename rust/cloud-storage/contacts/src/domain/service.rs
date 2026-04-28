use crate::domain::models::messages::ContactsMessage;
use crate::domain::models::user::Group;
use crate::domain::ports::{ContactsNotifier, ContactsRepository};

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
        self.repository.get_contacts(user_id).await.ok()
    }

    /// Adds a single contact connection between two users.
    pub async fn add_contact(&self, caller: &str, recipient: &str) -> Result<(), anyhow::Error> {
        self.repository
            .create_connections(vec![(caller.to_string(), recipient.to_string())])
            .await
    }

    /// Processes a contacts SQS message by computing all pairwise connections
    /// from the user list and persisting them.
    #[instrument(skip(self))]
    pub async fn process_message(&self, msg: &ContactsMessage) {
        let users_lower: Vec<String> = msg.users.iter().map(|s| s.to_lowercase()).collect();
        let connections = Group::new(&users_lower).generate();

        if connections.is_empty() {
            return;
        }

        if let Err(e) = self.repository.create_connections(connections).await {
            tracing::error!(error=?e, "couldn't create connections");
            return;
        }
        self.notifier.invalidate_contacts_for_users(&users_lower).await;
    }
}

#[cfg(test)]
mod test;
