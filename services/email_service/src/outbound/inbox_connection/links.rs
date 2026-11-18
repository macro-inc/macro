use super::*;
use macro_user_id::user_id::MacroUserIdStr;

pub struct PgConnectionLinks<R> {
    pub db: sqlx::PgPool,
    pub lookup: R,
}

impl<R: ConnectionLinkLookup> ConnectionLinks for PgConnectionLinks<R> {
    type Err = InboxPersistenceError;

    async fn attempt(&self, id: Uuid) -> Result<GoogleConnectionAttempt, Self::Err> {
        let attempt =
            macro_db_client::in_progress_user_link::get_in_progress_user_link(&self.db, &id)
                .await?;
        Ok(GoogleConnectionAttempt {
            provider: attempt.email_provider,
            owner: attempt.macro_user_id,
            email: attempt.linked_email,
            requested_scopes: attempt.requested_google_scopes,
            granted_scopes: attempt.granted_google_scopes,
        })
    }

    async fn account_for_email(&self, email: &str) -> Result<Option<String>, Self::Err> {
        match macro_db_client::user::get::get_user_id_by_email(self.db.clone(), email).await {
            Ok(id) => Ok(Some(id)),
            Err(sqlx::Error::RowNotFound) => Ok(None),
            Err(error) => Err(anyhow::Error::from(error).into()),
        }
    }

    async fn link_for_email(&self, email: &str) -> Result<Option<Link>, Self::Err> {
        Ok(email_db_client::links::get::fetch_link_by_email(
            &self.db,
            email,
            models_email::service::link::UserProvider::Gmail,
        )
        .await?)
    }

    async fn link_for_identity(
        &self,
        owner: &str,
        actor: MacroUserIdStr<'static>,
    ) -> Result<Option<Uuid>, Self::Err> {
        Ok(self
            .lookup
            .by_identity(owner, actor)
            .await
            .map_err(anyhow::Error::new)?)
    }

    async fn link_for_grant(&self, owner: &str, email: &str) -> Result<Option<Uuid>, Self::Err> {
        Ok(self
            .lookup
            .by_grant(owner, email)
            .await
            .map_err(anyhow::Error::new)?)
    }

    async fn account_fusion_id(&self, email: &str) -> Result<Option<Uuid>, Self::Err> {
        macro_db_client::user::get::get_macro_user_id_by_email(&self.db, email)
            .await
            .map_err(|error| anyhow::Error::from(error).into())
    }

    async fn organization(&self, actor: &str) -> Result<Option<i32>, Self::Err> {
        macro_db_client::user::get_user_organization::get_user_organization(self.db.clone(), actor)
            .await
            .map_err(|error| anyhow::Error::from(error).into())
    }

    async fn set_credential_owner(&self, link: Uuid, owner: &str) -> Result<(), Self::Err> {
        Ok(
            email_db_client::links::update::update_link_fusionauth_user_id(&self.db, link, owner)
                .await?,
        )
    }

    async fn cleanup_attempt(&self, link_id: Uuid, owner: &str) {
        macro_db_client::in_progress_user_link::delete_owned_in_progress_user_link(&self.db, link_id, owner)
            .await
            .inspect_err(|del_err| {
                tracing::warn!(error = ?del_err, ?link_id, "Failed to clean up in_progress_user_link after failed init");
            })
            .ok();
    }
}
