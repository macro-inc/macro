use crate::domain::models::graph::{UndirectedGraph, Vertex};
use crate::domain::models::messages::{
    ContactConnection, ContactConnections, ContactsMessage, ContactsNodes,
};
use crate::domain::models::page::{ContactCursor, ContactIdPage, ContactPageSize};
use crate::domain::models::query::ContactLookup;
use crate::domain::ports::{
    ContactsBackfillOutboxRepo, ContactsIngress, ContactsIngressQueue, ContactsNotifier,
    ContactsOutboxService, ContactsPageRepository, ContactsPageService, ContactsRepository,
    ContactsService,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::HashSet;
use std::sync::Arc;
use tracing::instrument;

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

impl<R: ContactsRepository, N: ContactsNotifier> ContactsDomainService<R, N> {
    /// Queries a user's contacts from the repository.
    #[tracing::instrument(err, skip(self))]
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

    /// Processes either the existing complete-graph message or a separate
    /// explicit-relationships message.
    #[instrument(err, skip(self))]
    pub(crate) async fn process_message(
        &self,
        msg: ContactsMessage,
    ) -> Result<(), rootcause::Report> {
        let (users, connections) = match msg {
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

        self.repository.create_connections(connections).await?;

        self.notifier
            .invalidate_contacts_for_users(users.into_iter().collect())
            .await?;
        Ok(())
    }
}

impl<R: ContactsRepository, N: ContactsNotifier> ContactsService for ContactsDomainService<R, N> {
    async fn query_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, rootcause::Report> {
        self.query_contacts(user_id).await
    }

    async fn add_contact_nodes(&self, nodes: ContactsNodes) -> Result<(), rootcause::Report> {
        self.process_message(ContactsMessage::Nodes(nodes)).await
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

/// How many relationships go in one contacts message. SQS rejects message
/// bodies over 256 KB, which a mailbox's whole contact list can exceed.
const CONNECTIONS_PER_MESSAGE: usize = 500;

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
