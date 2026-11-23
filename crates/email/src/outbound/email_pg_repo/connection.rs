//! Connection lookups reuse the existing repository methods and their spans.

use super::EmailPgRepo;
use crate::domain::{
    mailbox::connection::ConnectionLinkLookup, models::UserProvider, ports::EmailRepo,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

impl ConnectionLinkLookup for EmailPgRepo {
    type Err = sqlx::Error;

    async fn by_identity(
        &self,
        owner: &str,
        actor: MacroUserIdStr<'static>,
    ) -> Result<Option<Uuid>, Self::Err> {
        self.link_by_fusionauth_and_macro_id(owner, actor, UserProvider::Gmail)
            .await
            .map(|link| link.map(|link| link.id))
    }

    async fn by_grant(&self, owner: &str, email: &str) -> Result<Option<Uuid>, Self::Err> {
        self.link_by_fusionauth_email_provider(owner, email, UserProvider::Gmail)
            .await
            .map(|link| link.map(|link| link.id))
    }
}
