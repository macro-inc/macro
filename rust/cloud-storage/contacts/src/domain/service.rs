use crate::domain::models::graph::{UndirectedGraph, Vertex};
use crate::domain::models::messages::ContactsMessage;
use crate::domain::ports::{
    ContactsIngress, ContactsIngressQueue, ContactsNotifier, ContactsRepository, ContactsService,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::HashSet;
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
        msg: ContactsMessage,
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

    async fn add_contact(
        &self,
        caller: MacroUserIdStr<'_>,
        recipient: MacroUserIdStr<'_>,
    ) -> Result<(), rootcause::Report> {
        self.process_message(ContactsMessage {
            users: HashSet::from([caller.into_owned(), recipient.into_owned()]),
        })
        .await
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
        self.queue.publish(ContactsMessage { users }).await
    }
}

#[cfg(test)]
mod test;
