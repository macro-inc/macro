use crate::domain::models::backfill::{
    ChannelMember, ChannelRecord, ChannelSnapshot, InboxContact, InboxOwner, LegacyEdge,
    OrphanCheck, OrphanKind,
};
use crate::domain::models::contact::{Contact, ContactName, ContactPage};
use crate::domain::models::invalidation::ContactsInvalidation;
use crate::domain::models::list::InboxSource;
use crate::domain::models::listed::ListedContact;
use crate::domain::models::messages::{
    ContactConnection, ContactConnections, ContactsNodes, DirectoryChange,
};
use crate::domain::models::page::{ContactCursor, ContactIdPage, ContactPageSize};
use crate::domain::models::people::{PeopleSearchLimit, PeopleSearchQuery, PersonMatch};
use crate::domain::models::query::{ContactLookup, ContactSearch};
use chrono::{DateTime, Utc};
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

/// Writes to directed, list-aware directory membership. Every write is
/// idempotent and reports only the rows it added, so a repeat reports nothing.
pub trait ContactListRepository: Send + Sync + 'static {
    /// Add every user and every peer to each other's `interacted` list,
    /// skipping self-pairs and ids with no profile (a deleted account).
    /// Returns the added (owner, contact) pairs.
    fn record_interactions(
        &self,
        users: &[MacroUserIdStr<'static>],
        peers: &[MacroUserIdStr<'static>],
    ) -> impl Future<
        Output = Result<Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>, Report>,
    > + Send;

    /// Add contacts to the inbox owner's list for that inbox, skipping the
    /// owner. Writes nothing once the inbox is disconnected. Returns the
    /// contacts added.
    fn record_inbox_contacts(
        &self,
        inbox: &InboxSource,
        contacts: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;

    /// Add `contact` to `owner`'s `invited` list, skipping a self-invite.
    /// Directed: the contact's directory is unchanged. Returns whether the row
    /// was added.
    fn record_invite(
        &self,
        owner: &MacroUserIdStr<'static>,
        contact: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;

    /// The ids among `ids` that have no profile (deleted accounts).
    fn missing_profiles(
        &self,
        ids: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;

    /// Remove the user's own lists and every list entry naming them. Returns
    /// the other owners who lost them. Fails while the user's profile still
    /// exists, so a queued deletion is received again once nothing can add
    /// them back.
    fn delete_user_lists(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;
}

/// Bounded reads of the directed, list-aware directory: a person is in a
/// viewer's directory when they are in one of the viewer's stored lists or
/// inboxes, on the viewer's current team, or the viewer. Ids are canonical, so
/// pages are in plain byte order. It replaces [`ContactsPageRepository`] and
/// [`PeopleSearchRepository`] behind the `contacts-list-reads` flag.
pub trait ContactListReader: Send + Sync + 'static {
    /// One page of the viewer's directory, including the viewer, in contact-id
    /// order after the cursor.
    fn list_directory_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> impl Future<Output = Result<ContactIdPage, Report>> + Send;

    /// The requested ids that are in the viewer's directory, in request order.
    fn lookup_listed_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;

    /// The viewer's lists each requested contact is in, in request order.
    /// Contacts in none, including the viewer, are left out.
    fn contact_lists(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> impl Future<Output = Result<Vec<ListedContact>, Report>> + Send;

    /// One page of the users who have `subject` in their directory, including
    /// the subject, in user-id order after the cursor.
    fn audience_page(
        &self,
        subject: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> impl Future<Output = Result<ContactIdPage, Report>> + Send;

    /// Match `needle` (lowercase, at least two characters) against the email
    /// and Macro profile name of everyone in the viewer's directory. Rank
    /// teammates first, then `interacted` and `invited`, then inbox contacts,
    /// then anyone else (the viewer without a team); within a group, prefix
    /// matches first. Each match carries its lists. Return at most `limit`.
    fn search_listed_people(
        &self,
        viewer: MacroUserIdStr<'_>,
        needle: &str,
        limit: PeopleSearchLimit,
    ) -> impl Future<Output = Result<Vec<PersonMatch>, Report>> + Send;

    /// Everyone the viewer knows through a connected inbox (the `gmail` and
    /// `outlook` lists), each once, in no particular order.
    fn inbox_contacts(
        &self,
        viewer: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;
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

/// One bounded, ranked read of the people a viewer may search for.
pub trait PeopleSearchRepository: Send + Sync + 'static {
    /// Match `needle` (lowercase, at least two characters) against the email and
    /// Macro profile name of the viewer's contacts, self, and current teammates.
    /// Rank teammates first, then prefix matches, and return at most `limit`.
    fn search_people(
        &self,
        viewer: MacroUserIdStr<'_>,
        needle: &str,
        limit: PeopleSearchLimit,
    ) -> impl Future<Output = Result<Vec<PersonMatch>, Report>> + Send;
}

/// Ranked people search for authenticated inbound adapters.
pub trait PeopleSearchService: Send + Sync + 'static {
    /// Search only the authenticated viewer's contacts and current team. A query
    /// too short to search returns no people without reading storage.
    fn search_people(
        &self,
        viewer: MacroUserIdStr<'_>,
        query: &PeopleSearchQuery,
        limit: PeopleSearchLimit,
    ) -> impl Future<Output = Result<Vec<PersonMatch>, Report>> + Send;
}

/// The people a user has corresponded with by email.
pub trait CorrespondentsService: Send + Sync + 'static {
    /// The user's email correspondents, the user excluded, in no particular
    /// order. The legacy graph records no provenance, so there it is the
    /// user's whole directory.
    fn correspondents(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;
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
    /// Tells each user's clients their directory changed, naming the contacts
    /// to re-read when they are known.
    fn invalidate_contacts_for_users(
        &self,
        invalidations: Vec<ContactsInvalidation>,
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

    /// Publishes one bounded list-aware directory change to the queue.
    fn publish_change(
        &self,
        message: DirectoryChange,
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

/// Producer API for list-aware directory changes. Each call is split into
/// queue messages small enough for SQS, and each message is applied on its own,
/// so a retry after a partial publish only repeats idempotent writes.
pub trait ContactListIngress: Send + Sync + 'static {
    /// Record that every user and every peer have interacted. Mutual: each
    /// gains the other. Pass the same set as both to pair a whole channel.
    fn record_interactions(
        &self,
        users: Vec<MacroUserIdStr<'static>>,
        peers: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Record the people the inbox owner knows through that inbox. Directed:
    /// the contacts' own directories are unchanged.
    fn record_inbox_contacts(
        &self,
        inbox: InboxSource,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Tell each user's clients to re-read `changed`. Empty, or more than one
    /// lookup holds, means unknown: the clients fall back to their scan.
    fn directory_changed(
        &self,
        users: Vec<MacroUserIdStr<'static>>,
        changed: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;

    /// Drop the deleted user's directory and remove them from every other.
    fn user_deleted(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Trait for contacts service operations
pub trait ContactsService: Send + Sync + 'static {
    /// Queries a user's contacts.
    fn query_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, rootcause::Report>> + Send;

    /// The requested ids that are in the user's contacts, the user included.
    /// By default the whole directory is read and filtered; an implementation
    /// that can look ids up directly should.
    fn query_contacts_among(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, rootcause::Report>> + Send {
        async move {
            let wanted: HashSet<_> = ids.iter().collect();
            let mut contacts = self.query_contacts(user_id).await?;
            contacts.retain(|contact| wanted.contains(contact));
            Ok(contacts)
        }
    }

    /// Adds a contact connection between n users as a complete graph.
    fn add_contact_nodes(
        &self,
        nodes: ContactsNodes,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// Records a referral invite: `invitee` joins `inviter`'s `invited` list,
    /// and only the inviter is told to re-read them.
    fn invite_contact(
        &self,
        inviter: MacroUserIdStr<'static>,
        invitee: MacroUserIdStr<'static>,
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

/// Reads the legacy directory and the sources the backfill derives lists
/// from. Every read is one bounded page; callers page by the cursor each
/// returns.
pub trait LegacyDirectorySource: Send + Sync + 'static {
    /// Channels with an id after `after`, in id order.
    fn channel_page(
        &self,
        after: Uuid,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<ChannelRecord>, Report>> + Send;

    /// The Macro members of these channels, without bots or deleted accounts.
    fn channel_members(
        &self,
        channels: &[Uuid],
    ) -> impl Future<Output = Result<Vec<ChannelMember>, Report>> + Send;

    /// `contacts_backfill_outbox` rows with an id after `after`, in id order.
    fn snapshot_page(
        &self,
        after: i32,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<ChannelSnapshot>, Report>> + Send;

    /// The DMs among `channels` with a message from a person, sent at or
    /// after `since` when given.
    fn direct_messages_with_person_message(
        &self,
        channels: &[Uuid],
        since: Option<DateTime<Utc>>,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// Inbox owners after `after`, in owner order.
    fn inbox_owner_page(
        &self,
        after: &str,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<InboxOwner>, Report>> + Send;

    /// The owner's legacy contacts after `after`, in either direction and in
    /// contact order, each with the `inboxes` that know them.
    fn inbox_contact_page(
        &self,
        owner: &str,
        inboxes: &[Uuid],
        after: &str,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<InboxContact>, Report>> + Send;

    /// Legacy edges with an id after `after`, in id order, with the evidence
    /// the database holds for each direction.
    fn legacy_edge_page(
        &self,
        after: i32,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<LegacyEdge>, Report>> + Send;
}

/// Finds and removes list rows left by deleted accounts. Pages are bounded by
/// the number of owners or contacts read; each delete by its limit.
pub trait OrphanedListRows: Send + Sync + 'static {
    /// Owners or contacts after `after`, in id order, each with their rows of
    /// that kind when they have no account.
    fn orphan_page(
        &self,
        kind: OrphanKind,
        after: &str,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<OrphanCheck>, Report>> + Send;

    /// Delete up to `limit` of `id`'s rows of that kind, unless an account
    /// matches them now. Returns the rows deleted.
    fn delete_orphan_rows(
        &self,
        kind: OrphanKind,
        id: &str,
        limit: i64,
    ) -> impl Future<Output = Result<u64, Report>> + Send;
}
