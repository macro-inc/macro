use crate::domain::models::messages::ContactsMessage;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::HashSet;

/// Port trait for accessing the contacts data store.
pub trait ContactsRepository: Send + Sync + 'static {
    /// Gets the list of contact user IDs for a given user.
    fn get_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;

    /// Creates connection pairs between users within a transaction.
    fn create_connections(
        &self,
        connections: Vec<(MacroUserIdStr<'_>, MacroUserIdStr<'_>)>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port trait for notifying users about contact changes.
pub trait ContactsNotifier: Send + Sync + 'static {
    /// Invalidates cached contacts for the given user IDs.
    fn invalidate_contacts_for_users(
        &self,
        user_ids: Vec<MacroUserIdStr<'_>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port trait for publishing a contacts message to the ingress queue.
pub trait ContactsIngressQueue: Send + Sync + 'static {
    /// Publish a contacts message to the queue.
    fn publish(
        &self,
        message: ContactsMessage,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port trait for enqueuing contacts messages for async processing.
pub trait ContactsIngress: Send + Sync + 'static {
    /// Enqueues a set of user IDs to have their pairwise connections upserted.
    fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
