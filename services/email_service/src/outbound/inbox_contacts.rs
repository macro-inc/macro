//! Reads the sent-message contacts stored for one inbox.

use super::persistence_error::InboxPersistenceError;
use email::domain::mailbox::contacts::list::InboxContactsRepository;
use models_email::service::address::ContactInfoWithInteraction;
use uuid::Uuid;

pub struct PgInboxContacts(pub sqlx::PgPool);

impl InboxContactsRepository for PgInboxContacts {
    type Err = InboxPersistenceError;

    async fn contacts(&self, link: Uuid) -> Result<Vec<ContactInfoWithInteraction>, Self::Err> {
        Ok(email_db_client::contacts::get::fetch_contacts_by_link_id(&self.0, link).await?)
    }
}
