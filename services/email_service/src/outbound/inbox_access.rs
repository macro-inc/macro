//! Basic inbox lookup and delegation facts for the shared inbox catalog.

use super::persistence_error::InboxPersistenceError;
use email::domain::mailbox::catalog::InboxAccessRepository;
use models_email::service::link::Link;
use uuid::Uuid;

impl InboxAccessRepository for super::inbox_catalog::PgInboxCatalog {
    type Err = InboxPersistenceError;

    async fn inbox(&self, link: Uuid) -> Result<Option<Link>, Self::Err> {
        Ok(email_db_client::links::get::fetch_link_by_id(&self.0, link).await?)
    }

    async fn delegated(&self, caller: &str, owner: &str, link: Uuid) -> Result<bool, Self::Err> {
        Ok(macro_db_client::macro_user_links::edge_exists(&self.0, caller, owner, link).await?)
    }

    async fn accessible_inboxes(&self, caller: &str) -> Result<Vec<Link>, Self::Err> {
        Ok(email_db_client::links::get::fetch_inboxes_for_macro_id(&self.0, caller).await?)
    }
}
