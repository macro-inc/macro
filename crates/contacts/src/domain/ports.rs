use crate::domain::models::contact::{Contact, ContactName, ContactPage};
use crate::domain::models::messages::{ContactConnection, ContactConnections, ContactsNodes};
use crate::domain::models::page::{ContactCursor, ContactIdPage, ContactPageSize};
use crate::domain::models::query::{ContactLookup, ContactSearch};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::HashSet;
use uuid::Uuid;

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

/// Bounded directory reads, separate from the deployed full-list API.
pub trait ContactsPageRepository: Send + Sync + 'static {
    /// Select only requested graph neighbors or self, preserving request order.
    fn lookup_contact_ids(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;

    /// Return only the viewer's graph neighbors and self, in stable contact-ID
    /// order, after the cursor. Apply the bound in storage, not after loading all
    /// contacts. Preserve continuation progress when skipping invalid legacy IDs.
    fn contact_id_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> impl Future<Output = Result<ContactIdPage, Report>> + Send;
}

/// Bounded contact reads for authenticated inbound adapters.
pub trait ContactsPageService: Send + Sync + 'static {
    /// Authorize exact IDs against the authenticated viewer's directory.
    fn lookup_contact_ids(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;

    /// Read the authenticated viewer's contacts, including self, without an
    /// in-memory full-directory intermediate. The adapter supplies the viewer
    /// from authentication, never from a request body or cursor.
    fn contact_id_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> impl Future<Output = Result<ContactIdPage, Report>> + Send;
}

/// Resolves names only for the authorized, bounded IDs selected by the directory.
pub trait ContactNameReader: Send + Sync + 'static {
    /// Resolve at most MAX_CONTACT_PAGE_SIZE IDs with Macro profile names taking
    /// precedence over this viewer's address book. Missing names are not errors.
    fn contact_names(
        &self,
        viewer: MacroUserIdStr<'_>,
        contacts: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = Result<Vec<ContactName>, Report>> + Send;
}

/// Enriched directory reads for authenticated inbound adapters.
pub trait ContactDirectory: Send + Sync + 'static {
    /// Filter in source-ID order with bounded scan work. A non-null continuation
    /// means more source rows remain, even when no matches were returned.
    fn search_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
        search: &ContactSearch,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> impl Future<Output = Result<ContactPage, Report>> + Send;

    /// Resolve requested IDs only after graph membership checks, omitting unknown
    /// or unrelated people and retaining first-requested order.
    fn lookup_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> impl Future<Output = Result<Vec<Contact>, Report>> + Send;

    /// Read and enrich only one authorized page, preserving its continuation.
    fn contact_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> impl Future<Output = Result<ContactPage, Report>> + Send;
}

/// Port trait for notifying users about contact changes.
pub trait ContactsNotifier: Send + Sync + 'static {
    /// Invalidates cached contacts for the given user IDs.
    fn invalidate_contacts_for_users(
        &self,
        user_ids: Vec<MacroUserIdStr<'_>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port trait for telling a user's contacts that the user's picture changed.
pub trait UserPictureNotifier: Send + Sync + 'static {
    /// Notify `recipients` (one bounded page of contacts) that `user_id`'s
    /// picture changed so they refetch it.
    fn notify_picture_changed(
        &self,
        user_id: &MacroUserIdStr<'_>,
        recipients: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port trait for publishing a contacts message to the ingress queue.
pub trait ContactsIngressQueue: Send + Sync + 'static {
    /// Publishes a complete-graph contacts message to the queue.
    fn publish_nodes(
        &self,
        message: ContactsNodes,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Publishes explicit contact relationships to the queue.
    fn publish_connections(
        &self,
        message: ContactConnections,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Port trait for enqueuing contacts messages for async processing.
pub trait ContactsIngress: Send + Sync + 'static {
    /// Enqueues a set of user IDs to have their pairwise connections upserted.
    fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Enqueues only the supplied contact relationships for upsert.
    fn enqueue_contact_connections(
        &self,
        connections: Vec<ContactConnection>,
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
    #[allow(dead_code)]
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
