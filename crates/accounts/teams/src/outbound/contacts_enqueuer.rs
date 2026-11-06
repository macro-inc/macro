//! [`ContactsEnqueuer`] adapter backed by the contacts ingress.

#[cfg(test)]
mod test;

use std::sync::Arc;

use contacts::domain::{models::messages::ContactConnection, ports::ContactsIngress};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::contacts_enqueuer::ContactsEnqueuer;

/// Contacts enqueuer that delegates to a shared contacts ingress.
pub struct ContactsIngressEnqueuer<I> {
    ingress: Arc<I>,
}

impl<I> Clone for ContactsIngressEnqueuer<I> {
    fn clone(&self) -> Self {
        Self {
            ingress: self.ingress.clone(),
        }
    }
}

impl<I> ContactsIngressEnqueuer<I> {
    /// Creates a contacts enqueuer over the given shared ingress.
    pub fn new(ingress: Arc<I>) -> Self {
        Self { ingress }
    }
}

impl<I> ContactsEnqueuer for ContactsIngressEnqueuer<I>
where
    I: ContactsIngress,
{
    type Err = anyhow::Error;

    #[tracing::instrument(skip(self, connections), err)]
    async fn enqueue_contact_connections(
        &self,
        connections: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>,
    ) -> Result<(), Self::Err> {
        let connections = connections
            .into_iter()
            .map(|(first, second)| ContactConnection::new(first, second))
            .collect();

        self.ingress
            .enqueue_contact_connections(connections)
            .await
            .map_err(|e| anyhow::anyhow!("{e:?}"))
    }
}
