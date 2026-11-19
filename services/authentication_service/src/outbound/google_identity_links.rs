//! FusionAuth identity-link removal, and the connect attempts whose Google
//! identity link is due for release.

use crate::domain::google_identity_links::{DueAttempt, IdentityLinkAttempts, IdentityLinkRemover};
use fusionauth::FusionAuthClient;
use fusionauth::error::FusionAuthClientError;
use fusionauth::identity_provider::Link;
use std::sync::Arc;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The identity provider a Gmail connect links the mailbox's Google identity under.
pub const GMAIL_IDP_NAME: &str = "google_gmail";

#[derive(Debug, thiserror::Error)]
pub enum RemoveIdentityLinkError {
    #[error("no identity provider found")]
    NoIdentityProvider,
    #[error("unable to get identity provider id by name")]
    LookupProvider(#[source] FusionAuthClientError),
    #[error("unable to fetch links")]
    FetchLinks(#[source] FusionAuthClientError),
    #[error("unable to unlink user")]
    Unlink(#[source] FusionAuthClientError),
}

/// Selects the IdP link to remove by matching its display name against the linked email.
///
/// A FusionAuth user can hold several links to the same identity provider, one per email
/// address (e.g. a primary inbox plus delegated/secondary inboxes), so the link must be
/// selected by the linked email rather than derived from the owner's macro_id.
pub(crate) fn find_idp_link(links: Vec<Link>, linked_email: &str) -> Option<Link> {
    links
        .into_iter()
        .find(|l| l.display_name.eq_ignore_ascii_case(linked_email))
}

/// Removes `fusionauth_user_id`'s link to `idp_name` for `linked_email`. A link
/// or user already gone is a success, so retries don't wedge.
pub(crate) async fn remove_identity_link(
    auth_client: &FusionAuthClient,
    fusionauth_user_id: &str,
    linked_email: &str,
    idp_name: &str,
) -> Result<(), RemoveIdentityLinkError> {
    let idp_id = auth_client
        .get_identity_provider_id_by_name(idp_name)
        .await
        .map_err(|e| match e {
            FusionAuthClientError::NoIdentityProviderFound => {
                tracing::warn!("no identity provider found for name {}", idp_name);
                RemoveIdentityLinkError::NoIdentityProvider
            }
            e => {
                tracing::error!(error=?e, "unable to get identity provider id by name");
                RemoveIdentityLinkError::LookupProvider(e)
            }
        })?;

    tracing::trace!("removing link for idp id {}", idp_id);

    let links = match auth_client
        .get_links(fusionauth_user_id, Some(idp_id.clone()))
        .await
    {
        Ok(links) => links,
        // Deleting a FusionAuth user deletes its links with it.
        Err(FusionAuthClientError::UserDoesNotExist) => Vec::new(),
        Err(e) => {
            tracing::error!(error=?e, "error fetching links for userid {} and idp id {}", fusionauth_user_id, idp_id.as_str());
            return Err(RemoveIdentityLinkError::FetchLinks(e));
        }
    };

    // a fusionauth user can have multiple links to the same identity provider with different email
    // addresses, but can only have one link with a given email
    let Some(link) = find_idp_link(links, linked_email) else {
        // the link is already gone; treat removal as an idempotent no-op so retries don't wedge
        tracing::warn!(
            "no {} link found for user id {}; treating remove as no-op",
            idp_name,
            fusionauth_user_id
        );
        return Ok(());
    };

    auth_client
        .unlink_user(fusionauth_user_id, &idp_id, &link.identity_provider_user_id)
        .await
        .map_err(|e| match e {
            FusionAuthClientError::NoIdentityProviderFound => {
                tracing::warn!(
                    "no identity provider found for user id {}",
                    fusionauth_user_id
                );
                RemoveIdentityLinkError::NoIdentityProvider
            }
            e => {
                tracing::error!(error=?e, "unable to unlink user");
                RemoveIdentityLinkError::Unlink(e)
            }
        })
}

/// Removes Gmail identity links through FusionAuth.
pub struct FusionAuthIdentityLinks(pub Arc<FusionAuthClient>);

impl IdentityLinkRemover for FusionAuthIdentityLinks {
    type Err = RemoveIdentityLinkError;

    async fn remove(&self, fusionauth_user_id: Uuid, email: &str) -> Result<(), Self::Err> {
        remove_identity_link(
            &self.0,
            &fusionauth_user_id.to_string(),
            email,
            GMAIL_IDP_NAME,
        )
        .await
    }
}

/// Connect attempts kept in `in_progress_user_link`.
pub struct PgIdentityLinkAttempts(pub sqlx::PgPool);

impl IdentityLinkAttempts for PgIdentityLinkAttempts {
    type Err = anyhow::Error;

    async fn due(&self, limit: i64) -> Result<Vec<DueAttempt>, Self::Err> {
        Ok(
            macro_db_client::in_progress_user_link::identity_link_attempts_to_release(
                &self.0, limit,
            )
            .await?
            .into_iter()
            .map(|attempt| DueAttempt {
                id: attempt.id,
                fusionauth_user_id: attempt.fusionauth_user_id,
                email: attempt.linked_email,
            })
            .collect(),
        )
    }

    async fn retry_under_way(&self, attempt: &DueAttempt) -> Result<bool, Self::Err> {
        macro_db_client::in_progress_user_link::has_live_attempt_for_address(
            &self.0,
            attempt.id,
            attempt.fusionauth_user_id,
            &attempt.email,
        )
        .await
    }

    async fn link_backs_something(&self, attempt: &DueAttempt) -> Result<bool, Self::Err> {
        // The address got an account of its own, whose sign-in the identity
        // now is, or the requester connected the inbox after all.
        Ok(sqlx::query_scalar!(
            r#"SELECT EXISTS(SELECT 1 FROM "User" WHERE lower(email) = lower($1))
                OR EXISTS(SELECT 1 FROM email_links WHERE lower(email_address) = lower($1)
                    AND provider = 'GMAIL' AND fusionauth_user_id = $2) AS "backed!""#,
            attempt.email,
            attempt.fusionauth_user_id.to_string()
        )
        .fetch_one(&self.0)
        .await?)
    }

    async fn finish(&self, attempt: Uuid) -> Result<(), Self::Err> {
        macro_db_client::in_progress_user_link::delete_in_progress_user_link(&self.0, &attempt)
            .await
    }
}
