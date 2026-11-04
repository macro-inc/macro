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
