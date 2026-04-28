use crate::domain::models::graph::{CompleteUndirectedGraph, UndirectedGraph, Vertex};
use crate::domain::models::messages::ContactsMessage;
use crate::domain::ports::{ContactsNotifier, ContactsRepository};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;

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
    pub async fn add_contact(&self, caller: &str, recipient: &str) -> Result<(), Report> {
        let a = MacroUserIdStr::try_from(caller.to_owned())?;
        let b = MacroUserIdStr::try_from(recipient.to_owned())?;
        self.repository
            .create_connections(std::iter::once((a, b)))
            .await
    }

    /// Processes a contacts SQS message by computing all pairwise connections
    /// from the user list and persisting them.
    #[instrument(skip(self))]
    pub async fn process_message<'a>(&self, msg: &'a ContactsMessage) {
        let iter = msg.users.iter().map(Vertex::new);
        let graph: CompleteUndirectedGraph<'a, MacroUserIdStr<'static>> =
            UndirectedGraph::new(iter).complete();
        let connections = graph
            .inner()
            .edges()
            .map(|e| ((*e.a()).data().copied(), (*e.b()).data().copied()));

        if self
            .repository
            .create_connections(connections.into_iter())
            .await
            .is_err()
        {
            return;
        }

        self.notifier
            .invalidate_contacts_for_users(msg.users.iter().cloned())
            .await
            .inspect_err(|e| tracing::error!(error=?e, "failed to invalidate contacts"))
            .ok();
    }
}

#[cfg(test)]
mod test;
