//! Reads stored scheduled drafts in the existing creation-time order.

use super::persistence_error::InboxPersistenceError;
use email::domain::scheduled::drafts::ScheduledDraftRepository;
use models_email::service::message::Message;
use uuid::Uuid;

pub struct PgScheduledDrafts(pub sqlx::PgPool);

impl ScheduledDraftRepository for PgScheduledDrafts {
    type Err = InboxPersistenceError;

    async fn scheduled(
        &self,
        link: Uuid,
        offset: u32,
        limit: u32,
    ) -> Result<Vec<Message>, Self::Err> {
        Ok(
            email_db_client::messages::scheduled::get::get_scheduled_messages_by_link_id(
                &self.0, link, offset, limit,
            )
            .await?,
        )
    }
}
