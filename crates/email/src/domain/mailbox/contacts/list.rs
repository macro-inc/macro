//! Lists the sent-message contacts of the caller's owned and delegated inboxes.

use super::super::catalog::{InboxAccessRepository, InboxCatalogService};
use models_email::service::address::ContactInfoWithInteraction;
use std::{collections::HashMap, sync::Arc};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Stored contacts for one inbox, in interaction order.
pub trait InboxContactsRepository: Send + Sync + 'static {
    /// Original persistence failure.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Read recipients of sent messages belonging to this inbox.
    fn contacts(
        &self,
        link: Uuid,
    ) -> impl Future<Output = Result<Vec<ContactInfoWithInteraction>, Self::Err>> + Send;
}

/// A contact list failed to resolve inboxes or read one inbox's contacts.
#[derive(Debug, thiserror::Error)]
pub enum InboxContactsError<I, C> {
    /// The caller's inbox list failed.
    #[error("unable to fetch links")]
    Inboxes(#[source] I),
    /// A contact read failed; earlier inboxes are not returned as partial success.
    #[error("unable to fetch contacts")]
    Contacts(#[source] C),
}

/// Lists contacts across every inbox accessible to a caller.
pub struct ContactListService<R, C> {
    /// Supplies the caller's owned and delegated inboxes.
    pub catalog: Arc<InboxCatalogService<R>>,
    /// Reads each selected inbox's contacts in stored order.
    pub repository: C,
}

impl<R: InboxAccessRepository, C: InboxContactsRepository> ContactListService<R, C> {
    /// Include every owned and delegated inbox, preserving its contacts' stored order.
    pub async fn list(
        &self,
        caller: &str,
    ) -> Result<HashMap<Uuid, Vec<ContactInfoWithInteraction>>, InboxContactsError<R::Err, C::Err>>
    {
        let links = self.catalog.accessible_inboxes(caller).await.map_err(|e| {
            tracing::error!(error=?e, "unable to fetch links");
            InboxContactsError::Inboxes(e)
        })?;
        let mut contacts = HashMap::with_capacity(links.len());
        for link in links {
            let link_contacts = self.repository.contacts(link.id).await.map_err(|e| {
                tracing::error!(error=?e, "unable to fetch contacts");
                InboxContactsError::Contacts(e)
            })?;
            contacts.insert(link.id, link_contacts);
        }
        Ok(contacts)
    }
}
