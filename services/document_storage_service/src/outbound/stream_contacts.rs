//! Live-stream contact audience backed by the contacts crate's exact lookup.

use contacts::domain::models::query::ContactLookup;
use contacts::domain::ports::ContactsPageRepository;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use webhook::domain::ports::WebhookContactChecker;

/// Answers "is `other` a contact of `user`" with one indexed point lookup
/// (`lookup.sql`), never by paging the user's contact list.
pub struct ContactsStreamChecker<R> {
    repository: Arc<R>,
}

impl<R> ContactsStreamChecker<R> {
    /// Wrap the contacts repository shared with the rest of the service.
    pub fn new(repository: Arc<R>) -> Self {
        Self { repository }
    }
}

impl<R> Clone for ContactsStreamChecker<R> {
    fn clone(&self) -> Self {
        Self {
            repository: self.repository.clone(),
        }
    }
}

impl<R: ContactsPageRepository> WebhookContactChecker for ContactsStreamChecker<R> {
    type Err = anyhow::Error;

    async fn is_contact(
        &self,
        user: MacroUserIdStr<'static>,
        other: MacroUserIdStr<'static>,
    ) -> Result<bool, Self::Err> {
        let Some(lookup) = ContactLookup::new(vec![other.clone()]) else {
            return Ok(false);
        };
        let found = self
            .repository
            .lookup_contact_ids(user, &lookup)
            .await
            .map_err(|error| anyhow::anyhow!("contact lookup failed: {error:?}"))?;
        Ok(found.iter().any(|id| id.as_ref() == other.as_ref()))
    }
}

#[cfg(test)]
mod test;
