//! One provider-neutral inbox catalog for connection and feature state.

use super::*;
use crate::domain::models::{EmailBackfillStatus, EmailSyncStatus};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::{
    link::{Link, UserProvider},
    settings::Settings,
};

pub struct InboxCatalogFacts {
    pub link: Link,
    pub settings: Settings,
    pub latest_backfill_status: Option<EmailBackfillStatus>,
    pub photo_url: Option<String>,
    pub granted_scopes: Vec<String>,
    pub calendar_disabled: bool,
    pub has_calendar_data: bool,
}
pub struct InboxCatalogEntry {
    pub facts: InboxCatalogFacts,
    pub sync_status: EmailSyncStatus,
    pub needs_calendar_permission: bool,
}
pub trait InboxCatalogRepository: Send + Sync + 'static {
    fn accessible_details(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<InboxCatalogFacts>, MailboxError>> + Send;
}
pub struct InboxCatalogService<R>(pub R);
impl<R: InboxCatalogRepository> InboxCatalogService<R> {
    pub async fn list(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> Result<Vec<InboxCatalogEntry>, MailboxError> {
        Ok(self
            .0
            .accessible_details(actor)
            .await?
            .into_iter()
            .map(|facts| {
                let sync_status = EmailSyncStatus::derive(
                    facts.link.is_sync_active,
                    facts.link.needs_reauth,
                    facts.latest_backfill_status,
                );
                let has_calendar = match facts.link.provider {
                    UserProvider::Gmail => {
                        calendar_events::domain::models::GoogleScopeSet::from_scopes(
                            facts.granted_scopes.clone(),
                        )
                        .has_calendar_capability()
                    }
                    UserProvider::Outlook => facts.granted_scopes.iter().any(|scope| {
                        scope
                            .rsplit('/')
                            .next()
                            .is_some_and(|scope| scope.eq_ignore_ascii_case("Calendars.ReadWrite"))
                    }),
                };
                InboxCatalogEntry {
                    needs_calendar_permission: facts.calendar_disabled || !has_calendar,
                    sync_status,
                    facts,
                }
            })
            .collect())
    }
}

/// Basic inbox facts, shared by catalog consumers without loading feature details.
pub trait InboxAccessRepository: Send + Sync + 'static {
    /// Original persistence failure, preserved for the caller's existing error handling.
    type Err: std::error::Error + Send + Sync + 'static;
    /// Read an inbox without filtering by the caller.
    fn inbox(&self, link: Uuid) -> impl Future<Output = Result<Option<Link>, Self::Err>> + Send;
    /// Whether a delegation edge connects this caller to this inbox's owner.
    fn delegated(
        &self,
        caller: &str,
        owner: &str,
        link: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Read the caller's owned and delegated inboxes in their existing order.
    fn accessible_inboxes(
        &self,
        caller: &str,
    ) -> impl Future<Output = Result<Vec<Link>, Self::Err>> + Send;
}

/// How an authenticated caller reaches an inbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InboxAccess {
    /// The caller owns the inbox.
    Own,
    /// The caller has an explicit delegation edge.
    Delegated,
}

/// An inbox could not be resolved or accessed.
#[derive(Debug, thiserror::Error)]
pub enum InboxAccessError<E> {
    /// No inbox has this identifier.
    #[error("inbox not found")]
    NotFound,
    /// The caller has neither ownership nor a delegation edge.
    #[error("not authorized for this inbox")]
    Forbidden,
    /// A fact lookup failed.
    #[error(transparent)]
    Query(E),
}

impl<R: InboxAccessRepository> InboxCatalogService<R> {
    /// Resolve ownership first, querying delegation only for another owner's inbox.
    pub async fn authorize(
        &self,
        caller: &str,
        link: Uuid,
    ) -> Result<(Link, InboxAccess), InboxAccessError<R::Err>> {
        let link = self
            .0
            .inbox(link)
            .await
            .map_err(InboxAccessError::Query)?
            .ok_or(InboxAccessError::NotFound)?;
        if link.macro_id.as_ref() == caller {
            return Ok((link, InboxAccess::Own));
        }
        if self
            .0
            .delegated(caller, link.macro_id.as_ref(), link.id)
            .await
            .map_err(InboxAccessError::Query)?
        {
            Ok((link, InboxAccess::Delegated))
        } else {
            Err(InboxAccessError::Forbidden)
        }
    }

    /// Collection reads include both owned and delegated inboxes.
    pub async fn accessible_inboxes(&self, caller: &str) -> Result<Vec<Link>, R::Err> {
        self.0.accessible_inboxes(caller).await
    }
}

#[cfg(test)]
mod test;
