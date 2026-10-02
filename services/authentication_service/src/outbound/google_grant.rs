//! FusionAuth persistence for verified Google grants.

use crate::service::google_grant::{CreateGrantOutcome, GoogleGrant, GoogleGrantClient};
use fusionauth::{
    FusionAuthClient,
    error::FusionAuthClientError,
    identity_provider::{IdentityProviderLink, LinkUserRequest},
};
use rootcause::Report;
use std::borrow::Cow;
use uuid::Uuid;

/// Stores and refreshes grants using the FusionAuth API.
#[derive(Clone)]
pub struct FusionAuthGoogleGrants(pub FusionAuthClient);

impl GoogleGrantClient for FusionAuthGoogleGrants {
    async fn create(&self, grant: &GoogleGrant<'_>) -> Result<CreateGrantOutcome, Report> {
        match self
            .0
            .link_user(LinkUserRequest {
                identity_provider_link: IdentityProviderLink {
                    display_name: Cow::Borrowed(grant.email),
                    identity_provider_id: Cow::Borrowed(grant.identity_provider_id),
                    identity_provider_user_id: Cow::Borrowed(grant.subject),
                    user_id: Cow::Owned(grant.preferred_owner.to_string()),
                    token: Cow::Borrowed(grant.refresh_token),
                },
            })
            .await
        {
            Ok(()) => Ok(CreateGrantOutcome::Created),
            Err(FusionAuthClientError::IdentityProviderLinkAlreadyExists) => {
                Ok(CreateGrantOutcome::AlreadyLinked)
            }
            Err(error) => Err(Report::new(error).into_dynamic()),
        }
    }

    async fn owner(&self, grant: &GoogleGrant<'_>) -> Result<Option<Uuid>, Report> {
        self.0
            .get_link_by_subject(grant.identity_provider_id, grant.subject)
            .await
            .map_err(Report::new)?
            .map(|link| Uuid::parse_str(&link.user_id))
            .transpose()
            .map_err(|error| Report::new(error).into_dynamic())
    }

    async fn refresh(&self, grant: &GoogleGrant<'_>, owner: Uuid) -> Result<(), Report> {
        self.0
            .replace_identity_provider_grant(
                grant.identity_provider_id,
                &owner.to_string(),
                grant.email,
                Some(grant.subject),
                grant.refresh_token,
            )
            .await
            .map_err(|error| Report::new(error).into_dynamic())
    }
}
