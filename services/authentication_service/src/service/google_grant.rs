//! Resolves and refreshes Google grants without changing their login ownership.

use rootcause::Report;
use std::future::Future;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A grant obtained by exchanging a Google OAuth authorization code.
/// Intentionally has no Debug implementation: it carries a refresh token.
pub struct GoogleGrant<'a> {
    /// The Google identity provider configured for this consent.
    pub identity_provider_id: &'a str,
    /// The immutable Google subject returned by the token exchange.
    pub subject: &'a str,
    /// The normalized email returned by the token exchange.
    pub email: &'a str,
    /// The newly issued refresh token, excluded from tracing.
    pub refresh_token: &'a str,
    /// The owner to use only when this Google identity has no existing link.
    pub preferred_owner: Uuid,
}

/// The result of attempting to attach a newly authorized Google identity.
pub enum CreateGrantOutcome {
    /// A new identity link was created.
    Created,
    /// The identity already has a login owner.
    AlreadyLinked,
}

/// Provider persistence needed to connect a verified Google grant.
pub trait GoogleGrantClient: Send + Sync {
    /// Attempts to persist a new identity link.
    fn create(
        &self,
        grant: &GoogleGrant<'_>,
    ) -> impl Future<Output = Result<CreateGrantOutcome, Report>> + Send;
    /// Resolves an existing link by its verified provider subject.
    fn owner(
        &self,
        grant: &GoogleGrant<'_>,
    ) -> impl Future<Output = Result<Option<Uuid>, Report>> + Send;
    /// Replaces the grant while retaining its current login owner.
    fn refresh(
        &self,
        grant: &GoogleGrant<'_>,
        owner: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Connects OAuth grants through provider persistence.
#[derive(Clone)]
pub struct GoogleGrantService<C> {
    /// Provider persistence.
    pub client: C,
}

impl<C: GoogleGrantClient> GoogleGrantService<C> {
    /// Returns the actual grant owner for inbox provisioning. An existing login
    /// identity stays on its owner, even when the mailbox email is not a Macro profile.
    #[tracing::instrument(skip(self, grant), err)]
    pub async fn connect(&self, grant: GoogleGrant<'_>) -> Result<Uuid, Report> {
        match self.client.create(&grant).await? {
            CreateGrantOutcome::Created => Ok(grant.preferred_owner),
            CreateGrantOutcome::AlreadyLinked => {
                let owner = self.client.owner(&grant).await?.ok_or_else(|| {
                    rootcause::report!("existing Google grant could not be resolved")
                })?;
                self.client.refresh(&grant, owner).await?;
                Ok(owner)
            }
        }
    }
}
