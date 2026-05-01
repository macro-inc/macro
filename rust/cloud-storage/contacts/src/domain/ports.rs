use crate::domain::models::messages::ContactsNodes;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use sqlx::types::Uuid;
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
    fn publish(&self, message: ContactsNodes) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port trait for enqueuing contacts messages for async processing.
pub trait ContactsIngress: Send + Sync + 'static {
    /// Enqueues a set of user IDs to have their pairwise connections upserted.
    fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Trait for contacts service operations
pub trait ContactsService: Send + Sync + 'static {
    /// Queries a user's contacts.
    fn query_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, rootcause::Report>> + Send;

    /// Adds a contact connection between n users as a complete graph.
    fn add_contact_nodes(
        &self,
        nodes: ContactsNodes,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

/// Trait for outbox message processing
pub trait ContactsOutboxService: Send + Sync + 'static {
    /// polls the outbox for non-applied messages and attempts to apply them, marking them as done
    fn poll_outbox(&self) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

pub(crate) struct ContactsBackfillOutboxMessage {
    pub(crate) id: u64,
    #[expect(dead_code)]
    pub(crate) channel_id: Uuid,
    pub(crate) channel_participants: HashSet<MacroUserIdStr<'static>>,
}

pub(crate) trait ContactsBackfillOutboxRepo: Send + Sync + 'static {
    fn get_unapplied_messages(
        &self,
    ) -> impl Future<Output = Result<Vec<ContactsBackfillOutboxMessage>, rootcause::Report>> + Send;

    fn mark_message_applied(
        &self,
        id: u64,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}
