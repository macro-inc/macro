//! Account lookups for OAuth mailbox provisioning.

use crate::inbox_owner::{InboxOwner, InboxOwnerRepository};
use rootcause::Report;
#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

/// Reads account ownership through MacroDB's existing account APIs.
#[derive(Clone)]
pub struct PgInboxOwners(pub PgPool);

impl InboxOwnerRepository for PgInboxOwners {
    async fn by_email(&self, email: &str) -> Result<Option<InboxOwner>, Report> {
        let result =
            macro_db_client::user::get::get_user_macro_user_id_and_id_by_email(&self.0, email)
                .await;
        match result {
            Ok((fusionauth_id, macro_id)) => Ok(Some(InboxOwner {
                macro_id: MacroUserIdStr::try_from(macro_id)
                    .map_err(|error| rootcause::report!("{error:?}"))?,
                fusionauth_id,
            })),
            Err(sqlx::Error::RowNotFound) => Ok(None),
            Err(error) => Err(Report::new(error).into_dynamic()),
        }
    }

    async fn has_inbox(&self, email: &str) -> Result<bool, Report> {
        Ok(email_db_client::links::get::fetch_link_by_email(
            &self.0,
            email,
            models_email::service::link::UserProvider::Gmail,
        )
        .await
        .map_err(|error| rootcause::report!("{error:?}"))?
        .is_some())
    }

    async fn inbox_uses_grant(
        &self,
        email: &str,
        profile: &MacroUserIdStr<'_>,
        grant_owner: Uuid,
    ) -> Result<bool, Report> {
        Ok(email_db_client::links::get::fetch_link_by_email(
            &self.0,
            email,
            models_email::service::link::UserProvider::Gmail,
        )
        .await
        .map_err(|error| rootcause::report!("{error:?}"))?
        .is_some_and(|link| {
            link.macro_id.as_ref() == profile.as_ref()
                && link.fusionauth_user_id == grant_owner.to_string()
        }))
    }

    async fn already_delegated(
        &self,
        email: &str,
        grant_owner: Uuid,
        requester: Uuid,
    ) -> Result<bool, Report> {
        let Some(link) = email_db_client::links::get::fetch_link_by_email(
            &self.0,
            email,
            models_email::service::link::UserProvider::Gmail,
        )
        .await
        .map_err(|error| rootcause::report!("{error:?}"))?
        else {
            return Ok(false);
        };
        if link.fusionauth_user_id != grant_owner.to_string() {
            return Ok(false);
        }
        let requester = self.by_fusionauth_id(requester).await?;
        macro_db_client::macro_user_links::edge_exists(
            &self.0,
            requester.macro_id.as_ref(),
            link.macro_id.as_ref(),
            link.id,
        )
        .await
        .map_err(|error| rootcause::report!("{error:?}"))
    }

    async fn by_fusionauth_id(&self, id: Uuid) -> Result<InboxOwner, Report> {
        let user = macro_db_client::macro_user::get_macro_user(&self.0, &id.to_string())
            .await
            .map_err(|error| rootcause::report!("{error:?}"))?;
        let owner = self
            .by_email(&user.email)
            .await?
            .ok_or_else(|| rootcause::report!("Google grant owner has no Macro profile"))?;
        if owner.fusionauth_id != id {
            return Err(rootcause::report!(
                "Google grant owner profile no longer matches"
            ));
        }
        Ok(owner)
    }
}
