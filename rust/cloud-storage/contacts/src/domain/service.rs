use crate::domain::models::graph::{UndirectedGraph, Vertex};
use crate::domain::models::messages::ContactsNodes;
use crate::domain::ports::{
    ContactsBackfillOutboxRepo, ContactsIngress, ContactsIngressQueue, ContactsNotifier,
    ContactsOutboxService, ContactsRepository, ContactsService,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::HashSet;
use std::sync::Arc;
use tracing::instrument;

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

    /// Processes a contacts SQS message by computing all pairwise connections
    /// from the user list and persisting them.
    #[instrument(err, skip(self))]
    pub(crate) async fn process_message(
        &self,
        msg: ContactsNodes,
    ) -> Result<(), rootcause::Report> {
        let connections: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)> = {
            let graph = UndirectedGraph::new(msg.users.iter().map(Vertex::new)).complete();
            graph
                .inner()
                .edges()
                .map(|e| (e.a().data().clone(), e.b().data().clone()))
                .collect()
        };

        self.repository.create_connections(connections).await?;

        self.notifier
            .invalidate_contacts_for_users(msg.users.into_iter().collect())
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
        self.process_message(nodes).await
    }
}

/// Queue-backed implementation of [`ContactsIngress`].
///
/// Serialises the user set into a [`ContactsMessage`] and publishes it through
/// the provided [`ContactsIngressQueue`]. The heavy lifting (computing pairwise
/// connections, persisting them) is done by the contacts service worker that
/// consumes from that queue.
pub struct SqsContactsIngress<Q> {
    /// The queue used to publish contacts messages.
    pub queue: Q,
}

impl<Q: ContactsIngressQueue> ContactsIngress for SqsContactsIngress<Q> {
    async fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        self.queue.publish(ContactsNodes { users }).await
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
