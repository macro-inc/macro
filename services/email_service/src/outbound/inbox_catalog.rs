use email::domain::{
    mailbox::{MailboxError, catalog::*},
    models::EmailBackfillStatus,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_email::service::backfill::BackfillJobStatus;

pub struct PgInboxCatalog(pub sqlx::PgPool);
impl InboxCatalogRepository for PgInboxCatalog {
    async fn accessible_details(
        &self,
        actor: &MacroUserIdStr<'_>,
    ) -> Result<Vec<InboxCatalogFacts>, MailboxError> {
        Ok(
            email_db_client::links::get::fetch_inbox_details_for_macro_id(&self.0, actor)
                .await
                .map_err(|_| MailboxError::Persistence)?
                .into_iter()
                .map(|inbox| InboxCatalogFacts {
                    link: inbox.link,
                    settings: inbox.settings,
                    latest_backfill_status: inbox.latest_backfill_status.map(
                        |status| match status {
                            BackfillJobStatus::Init => EmailBackfillStatus::Init,
                            BackfillJobStatus::InProgress => EmailBackfillStatus::InProgress,
                            BackfillJobStatus::Complete => EmailBackfillStatus::Complete,
                            BackfillJobStatus::Cancelled => EmailBackfillStatus::Cancelled,
                            BackfillJobStatus::Failed => EmailBackfillStatus::Failed,
                        },
                    ),
                    photo_url: inbox.photo_url,
                    granted_scopes: inbox.provider_granted_scopes,
                    calendar_disabled: inbox.calendar_disabled,
                    has_calendar_data: inbox.has_calendar_data,
                })
                .collect(),
        )
    }
}
