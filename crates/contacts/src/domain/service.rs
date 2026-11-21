use crate::domain::models::graph::{UndirectedGraph, Vertex};
use crate::domain::models::invalidation::{ContactsInvalidation, MAX_CHANGED_CONTACTS};
use crate::domain::models::list::InboxSource;
use crate::domain::models::messages::{
    ContactConnection, ContactConnections, ContactsMessage, ContactsNodes, DirectoryChange,
};
use crate::domain::models::page::{ContactCursor, ContactIdPage, ContactPageSize};
use crate::domain::models::people::{PeopleSearchLimit, PeopleSearchQuery, PersonMatch};
use crate::domain::models::query::ContactLookup;
use crate::domain::ports::{
    ContactListIngress, ContactListRepository, ContactsBackfillOutboxRepo, ContactsIngress,
    ContactsIngressQueue, ContactsNotifier, ContactsOutboxService, ContactsPageRepository,
    ContactsPageService, ContactsRepository, ContactsService, CorrespondentsService,
    PeopleSearchRepository, PeopleSearchService,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Bounded name enrichment of the viewer's contact graph.
pub mod directory;
/// Realtime fan-out of a user's picture change to their contacts.
pub mod picture_fanout;
#[cfg(test)]
mod test;

/// Domain service combining a repository and notifier to manage contacts.
pub struct ContactsDomainService<R, N> {
    /// The contacts repository for data persistence.
    pub repository: R,
    /// The notifier for real-time contact invalidation.
    pub notifier: N,
}

impl<R: ContactsRepository + ContactListRepository, N: ContactsNotifier>
    ContactsDomainService<R, N>
{
    /// Queries a user's contacts from the repository.
    #[tracing::instrument(name = "contacts.query", skip_all, err)]
    async fn query_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        let mut res = self.repository.get_contacts(user_id.copied()).await?;
        // because the database data is a graph there is no edge from Self<->Self
        // we just aritificially insert self as a special case
        res.push(user_id.into_owned());
        Ok(res)
    }

    /// Processes a list-aware directory change, the existing complete-graph
    /// message, or a separate explicit-relationships message.
    #[tracing::instrument(
        name = "contacts.process_message",
        skip_all,
        fields(
            kind = msg.kind(),
            users = tracing::field::Empty,
            connections = tracing::field::Empty,
        ),
        err
    )]
    pub(crate) async fn process_message(
        &self,
        msg: ContactsMessage,
    ) -> Result<(), rootcause::Report> {
        let (users, connections): (HashSet<_>, Vec<_>) = match msg {
            ContactsMessage::Change(change) => return self.process_change(change).await,
            ContactsMessage::Nodes(ContactsNodes { users }) => {
                let graph = UndirectedGraph::new(users.iter().map(Vertex::new)).complete();
                let connections = graph
                    .inner()
                    .edges()
                    .map(|edge| (edge.a().data().clone(), edge.b().data().clone()))
                    .collect();
                (users, connections)
            }
            ContactsMessage::Connections(ContactConnections { connections }) => {
                let users = connections
                    .iter()
                    .flat_map(|connection| [&connection.first, &connection.second])
                    .cloned()
                    .collect();
                let connections = connections
                    .into_iter()
                    .map(|connection| (connection.first, connection.second))
                    .collect();
                (users, connections)
            }
        };

        let span = tracing::Span::current();
        span.record("users", users.len() as i64);
        span.record("connections", connections.len() as i64);

        let invalidations = invalidations_by_user(users, &connections);
        self.repository.create_connections(connections).await?;

        self.notifier
            .invalidate_contacts_for_users(invalidations)
            .await?;
        Ok(())
    }

    /// Applies one list-aware change and notifies only the owners whose
    /// directories it changed, naming the contacts each one gained.
    #[tracing::instrument(
        name = "contacts.directory_change",
        skip_all,
        fields(change = tracing::field::Empty, notified = tracing::field::Empty),
        err
    )]
    async fn process_change(&self, change: DirectoryChange) -> Result<(), Report> {
        let span = tracing::Span::current();
        let invalidations = match change {
            DirectoryChange::Interacted { users, peers } => {
                span.record("change", "interacted");
                let added = self.repository.record_interactions(&users, &peers).await?;
                self.drop_deleted_accounts(added).await?
            }
            DirectoryChange::InboxContacts { inbox, contacts } => {
                span.record("change", "inbox_contacts");
                self.record_inbox_contacts(inbox, contacts).await?
            }
            DirectoryChange::Changed { users, changed } => {
                span.record("change", "changed");
                users
                    .into_iter()
                    .map(|user| ContactsInvalidation::new(user, changed.clone()))
                    .collect()
            }
            DirectoryChange::UserDeleted { user } => {
                span.record("change", "user_deleted");
                // A removal has no contacts to re-read; the owners' clients
                // drop the user on their next scan.
                self.repository
                    .delete_user_lists(&user)
                    .await?
                    .into_iter()
                    .map(ContactsInvalidation::unknown)
                    .collect()
            }
        };

        span.record("notified", invalidations.len() as i64);
        if invalidations.is_empty() {
            return Ok(());
        }
        self.notifier
            .invalidate_contacts_for_users(invalidations)
            .await
    }

    /// Removes rows an interaction added for an account deleted while it was
    /// being written. The insert skips ids with no profile, but its snapshot
    /// may predate a profile delete that commits, and whose `UserDeleted` is
    /// applied, before the insert commits. Checking again once it has
    /// committed closes that: a profile still present now is deleted later,
    /// and its `UserDeleted`, which waits for that, removes these rows.
    async fn drop_deleted_accounts(
        &self,
        added: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>,
    ) -> Result<Vec<ContactsInvalidation>, Report> {
        if added.is_empty() {
            return Ok(Vec::new());
        }

        let (deleted, lost_one) = remove_deleted_accounts(&self.repository, &added).await?;
        if deleted.is_empty() {
            return Ok(invalidations_by_owner(added));
        }

        // Owners who lost a deleted account re-read everything, like any
        // removal; everyone else is told only what they gained.
        let kept = added
            .into_iter()
            .filter(|(owner, contact)| {
                !deleted.contains(owner) && !deleted.contains(contact) && !lost_one.contains(owner)
            })
            .collect();
        let mut invalidations = invalidations_by_owner(kept);
        invalidations.extend(
            lost_one
                .into_iter()
                .filter(|owner| !deleted.contains(owner))
                .map(ContactsInvalidation::unknown),
        );
        Ok(invalidations)
    }

    /// Writes the legacy edge for each contact, so the old read path stays
    /// complete, then the inbox rows. The legacy write goes first: a retry
    /// after it fails still finds the inbox rows missing and notifies.
    async fn record_inbox_contacts(
        &self,
        inbox: InboxSource,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> Result<Vec<ContactsInvalidation>, Report> {
        let legacy_edges = contacts
            .iter()
            .map(|contact| (inbox.owner.copied(), contact.copied()))
            .collect();
        self.repository.create_connections(legacy_edges).await?;

        let added = self
            .repository
            .record_inbox_contacts(&inbox, &contacts)
            .await?;
        if added.is_empty() {
            return Ok(Vec::new());
        }
        Ok(vec![ContactsInvalidation::new(inbox.owner, added)])
    }
}

/// Groups added (owner, contact) pairs into one invalidation per owner.
fn invalidations_by_owner(
    added: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>,
) -> Vec<ContactsInvalidation> {
    let mut by_owner: HashMap<_, Vec<_>> = HashMap::new();
    for (owner, contact) in added {
        by_owner.entry(owner).or_default().push(contact);
    }
    by_owner
        .into_iter()
        .map(|(owner, contacts)| ContactsInvalidation::new(owner, contacts))
        .collect()
}

/// One invalidation per user, naming the other end of each of the user's
/// connections. Self-connections name nobody.
fn invalidations_by_user(
    users: HashSet<MacroUserIdStr<'static>>,
    connections: &[(MacroUserIdStr<'static>, MacroUserIdStr<'static>)],
) -> Vec<ContactsInvalidation> {
    let mut peers: HashMap<_, HashSet<_>> = HashMap::new();
    for (first, second) in connections {
        if first == second {
            continue;
        }

        peers.entry(first).or_default().insert(second);
        peers.entry(second).or_default().insert(first);
    }

    users
        .into_iter()
        .map(|user| {
            let mut changed: Vec<_> = peers
                .get(&user)
                .into_iter()
                .flatten()
                .map(|&peer| peer.clone())
                .collect();
            changed.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));
            ContactsInvalidation::new(user, changed)
        })
        .collect()
}

impl<R: ContactsRepository + ContactListRepository, N: ContactsNotifier> ContactsService
    for ContactsDomainService<R, N>
{
    async fn query_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        self.query_contacts(user_id).await
    }

    async fn add_contact_nodes(&self, nodes: ContactsNodes) -> Result<(), rootcause::Report> {
        self.process_message(ContactsMessage::Nodes(nodes)).await
    }

    /// Writes the legacy edge, so the old read path stays complete, then the
    /// directed `invited` row, then tells the inviter to re-read the invitee.
    /// The notification is sent even when the row already existed, so a retry
    /// after a failed notification still delivers it; one extra lookup on a
    /// rate-limited route is cheap.
    #[tracing::instrument(
        name = "contacts.invite",
        skip_all,
        fields(added = tracing::field::Empty),
        err
    )]
    async fn invite_contact(
        &self,
        inviter: MacroUserIdStr<'static>,
        invitee: MacroUserIdStr<'static>,
    ) -> Result<(), Report> {
        self.repository
            .create_connections(vec![(inviter.copied(), invitee.copied())])
            .await?;

        if inviter == invitee {
            return Ok(());
        }
        let added = self.repository.record_invite(&inviter, &invitee).await?;
        tracing::Span::current().record("added", added);
        self.notifier
            .invalidate_contacts_for_users(vec![ContactsInvalidation::new(inviter, vec![invitee])])
            .await
    }
}

impl<R: ContactsPageRepository, N: ContactsNotifier> ContactsPageService
    for ContactsDomainService<R, N>
{
    #[tracing::instrument(name = "contacts.lookup", skip_all, fields(count = lookup.ids().len() as i64), err)]
    async fn lookup_contact_ids(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.repository.lookup_contact_ids(viewer, lookup).await
    }

    #[tracing::instrument(name = "contacts.page", skip_all, fields(limit = i64::from(limit.get()), has_cursor = after.is_some()), err)]
    async fn contact_id_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        self.repository.contact_id_page(viewer, after, limit).await
    }
}

impl<R: PeopleSearchRepository, N: ContactsNotifier> PeopleSearchService
    for ContactsDomainService<R, N>
{
    async fn search_people(
        &self,
        viewer: MacroUserIdStr<'_>,
        query: &PeopleSearchQuery,
        limit: PeopleSearchLimit,
    ) -> Result<Vec<PersonMatch>, Report> {
        search_people_with(query, limit, |needle| {
            self.repository.search_people(viewer, needle, limit)
        })
        .await
    }
}

/// Runs one ranked people search through `read`: a query too short to search
/// returns no people without reading, and a read that returns more than
/// `limit` people is an error.
#[tracing::instrument(
    name = "contacts.directory.people_search",
    skip_all,
    fields(
        limit = i64::from(limit.get()),
        query_bytes = query.byte_len() as i64,
        result_count = tracing::field::Empty,
        outcome = tracing::field::Empty,
    ),
    err
)]
pub(crate) async fn search_people_with<'q, Read, Fut>(
    query: &'q PeopleSearchQuery,
    limit: PeopleSearchLimit,
    read: Read,
) -> Result<Vec<PersonMatch>, Report>
where
    Read: FnOnce(&'q str) -> Fut,
    Fut: Future<Output = Result<Vec<PersonMatch>, Report>>,
{
    let span = tracing::Span::current();
    let Some(needle) = query.searchable() else {
        span.record("result_count", 0_i64);
        span.record("outcome", "query_too_short");
        return Ok(Vec::new());
    };
    let people = read(needle).await.inspect_err(|_| {
        span.record("outcome", "error");
    })?;
    if people.len() > usize::from(limit.get()) {
        span.record("outcome", "error");
        return Err(rootcause::report!("people search exceeded its limit"));
    }
    span.record("result_count", people.len() as i64);
    span.record(
        "outcome",
        if people.is_empty() {
            "no_match"
        } else {
            "match"
        },
    );
    Ok(people)
}

impl<R: ContactsRepository, N: ContactsNotifier> CorrespondentsService
    for ContactsDomainService<R, N>
{
    /// The legacy graph cannot tell an email correspondent from anyone else,
    /// so this is the whole directory without the user.
    async fn correspondents(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.repository.get_contacts(user_id).await
    }
}

/// How many relationships go in one contacts message. SQS rejects message
/// bodies over 256 KB, which a mailbox's whole contact list can exceed.
const CONNECTIONS_PER_MESSAGE: usize = 500;

/// How many users one interactions message pairs with its peers. With
/// [`IDS_PER_MESSAGE`] peers this bounds one message to 10,000 rows, both
/// directions included.
const INTERACTION_USERS_PER_MESSAGE: usize = 10;

/// How many ids one list in a directory-change message holds, which keeps the
/// body far under the SQS limit.
const IDS_PER_MESSAGE: usize = 500;

/// Queue-backed implementation of [`ContactsIngress`].
///
/// Serialises complete-graph or explicit-relationship messages and publishes
/// them through the provided [`ContactsIngressQueue`]. Persistence is handled
/// by the contacts service worker that consumes from that queue.
pub struct SqsContactsIngress<Q> {
    /// The queue used to publish contacts messages.
    pub queue: Q,
}

impl<Q: ContactsIngressQueue> ContactsIngress for SqsContactsIngress<Q> {
    async fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        self.queue.publish_nodes(ContactsNodes { users }).await
    }

    async fn enqueue_contact_connections(
        &self,
        connections: Vec<ContactConnection>,
    ) -> Result<(), Report> {
        // Each message is upserted on its own, so a retry after a partial
        // publish only repeats upserts.
        for chunk in connections.chunks(CONNECTIONS_PER_MESSAGE) {
            self.queue
                .publish_connections(ContactConnections::new(chunk.to_vec()))
                .await?;
        }
        Ok(())
    }
}

impl<Q: ContactsIngressQueue> ContactListIngress for SqsContactsIngress<Q> {
    async fn record_interactions(
        &self,
        users: Vec<MacroUserIdStr<'static>>,
        peers: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        for users in users.chunks(INTERACTION_USERS_PER_MESSAGE) {
            for peers in peers.chunks(IDS_PER_MESSAGE) {
                self.queue
                    .publish_change(DirectoryChange::Interacted {
                        users: users.to_vec(),
                        peers: peers.to_vec(),
                    })
                    .await?;
            }
        }
        Ok(())
    }

    async fn record_inbox_contacts(
        &self,
        inbox: InboxSource,
        contacts: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        for contacts in contacts.chunks(IDS_PER_MESSAGE) {
            self.queue
                .publish_change(DirectoryChange::InboxContacts {
                    inbox: inbox.clone(),
                    contacts: contacts.to_vec(),
                })
                .await?;
        }
        Ok(())
    }

    async fn directory_changed(
        &self,
        users: Vec<MacroUserIdStr<'static>>,
        changed: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        // More than one lookup can re-read is sent as unknown rather than
        // split, because each user needs the whole list.
        let changed = if changed.len() > MAX_CHANGED_CONTACTS {
            Vec::new()
        } else {
            changed
        };
        for users in users.chunks(IDS_PER_MESSAGE) {
            self.queue
                .publish_change(DirectoryChange::Changed {
                    users: users.to_vec(),
                    changed: changed.clone(),
                })
                .await?;
        }
        Ok(())
    }

    async fn user_deleted(&self, user: MacroUserIdStr<'static>) -> Result<(), Report> {
        self.queue
            .publish_change(DirectoryChange::UserDeleted { user })
            .await
    }
}

/// Domain service that polls the backfill outbox and applies pending entries.
pub struct ContactsOutboxServiceImpl<O, S> {
    /// The outbox repository for fetching and marking applied messages.
    pub outbox_repo: O,
    /// The inner contacts service used to apply each outbox entry.
    pub inner_service: Arc<S>,
}

impl<O, S> ContactsOutboxService for ContactsOutboxServiceImpl<O, S>
where
    O: ContactsBackfillOutboxRepo,
    S: ContactsService,
{
    async fn poll_outbox(&self) -> Result<(), rootcause::Report> {
        let messages = self.outbox_repo.get_unapplied_messages().await?;
        for message in messages {
            let Ok(()) = self
                .inner_service
                .add_contact_nodes(ContactsNodes {
                    users: message.channel_participants,
                })
                .await
            else {
                continue;
            };
            let _ = self.outbox_repo.mark_message_applied(message.id).await;
        }
        Ok(())
    }
}

/// Finds the accounts among the ids `added` names that no longer have a
/// profile, and removes every list row for them. Returns those accounts and
/// the other owners who lost them. Used after each interaction write, by the
/// worker and the backfill, because a write can commit after the deletion
/// that should have removed its rows.
pub(crate) async fn remove_deleted_accounts<R: ContactListRepository>(
    repository: &R,
    added: &[(MacroUserIdStr<'static>, MacroUserIdStr<'static>)],
) -> Result<
    (
        HashSet<MacroUserIdStr<'static>>,
        HashSet<MacroUserIdStr<'static>>,
    ),
    Report,
> {
    let mut lost_one = HashSet::new();
    if added.is_empty() {
        return Ok((HashSet::new(), lost_one));
    }

    let named: HashSet<_> = added
        .iter()
        .flat_map(|(owner, contact)| [owner.clone(), contact.clone()])
        .collect();
    let named: Vec<_> = named.into_iter().collect();
    let deleted: HashSet<_> = repository
        .missing_profiles(&named)
        .await?
        .into_iter()
        .collect();
    for user in &deleted {
        lost_one.extend(repository.delete_user_lists(user).await?);
    }
    Ok((deleted, lost_one))
}
