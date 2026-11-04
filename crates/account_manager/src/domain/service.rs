//! Account manager service implementation.

#[cfg(test)]
mod test;

use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use user_api_key::domain::models::UserApiKey;
use uuid::Uuid;

use crate::domain::models::{
    AccountManagerDecision, AccountManagerError, AccountManagerGrant, AccountManagerGrantStatus,
    AccountManagerRole, RESPONSE_WINDOW,
};
use crate::domain::ports::{
    AccountManagerDelivery, AccountManagerRepo, AccountManagerService, ClaimedCredential,
};

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> AccountManagerError {
    rootcause::Report::new(error).into_dynamic().into()
}

/// Concrete account manager service.
#[derive(Debug, Clone)]
pub struct AccountManagerServiceImpl<R, D> {
    repo: R,
    delivery: D,
}

impl<R, D> AccountManagerServiceImpl<R, D>
where
    R: AccountManagerRepo,
    D: AccountManagerDelivery,
{
    /// Create the service from its repository and DM delivery.
    pub fn new(repo: R, delivery: D) -> Self {
        Self { repo, delivery }
    }

    /// Load a grant the caller is part of. A stranger gets the same answer as
    /// for a grant that doesn't exist.
    async fn load(
        &self,
        caller: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<(AccountManagerGrant, AccountManagerRole), AccountManagerError> {
        let grant = self
            .repo
            .get(id)
            .await
            .map_err(internal)?
            .ok_or(AccountManagerError::NotFound)?;
        let role = grant.role_of(caller).ok_or(AccountManagerError::NotFound)?;

        Ok((grant.at(Utc::now()), role))
    }
}

impl<R, D> AccountManagerService for AccountManagerServiceImpl<R, D>
where
    R: AccountManagerRepo,
    D: AccountManagerDelivery,
{
    #[tracing::instrument(err, skip_all, fields(role = %caller_role, grant_id = tracing::field::Empty))]
    async fn request(
        &self,
        caller: &MacroUserIdStr<'static>,
        counterparty: &MacroUserIdStr<'static>,
        caller_role: AccountManagerRole,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        if caller.as_ref() == counterparty.as_ref() {
            return Err(AccountManagerError::BadRequest(
                "an account cannot manage itself",
            ));
        }

        let (managed, manager) = match caller_role {
            AccountManagerRole::Managed => (caller, counterparty),
            AccountManagerRole::Manager => (counterparty, caller),
        };

        let manager_is_agent = self.repo.is_agent(manager).await.map_err(internal)?;
        let managed_exists = self.repo.is_agent(managed).await.map_err(internal)?;
        if manager_is_agent.is_none() || managed_exists.is_none() {
            return Err(AccountManagerError::BadRequest("no such user"));
        }
        if manager_is_agent != Some(true) {
            return Err(AccountManagerError::BadRequest(
                "only an agent account can be an account manager",
            ));
        }

        let now = Utc::now();
        let expires_at = now + RESPONSE_WINDOW;
        let opened = self
            .repo
            .open_request(Uuid::now_v7(), managed, manager, caller_role, expires_at)
            .await
            .map_err(internal)?;
        tracing::Span::current().record("grant_id", tracing::field::display(opened.grant.id));

        if !opened.created {
            return Ok(opened.grant);
        }

        // A request the other side never hears about must not block a retry.
        if let Err(error) = self
            .delivery
            .deliver_request(caller, counterparty, opened.grant.id)
            .await
        {
            self.repo.revoke(opened.grant.id).await.map_err(internal)?;
            return Err(error.into());
        }

        Ok(opened.grant)
    }

    #[tracing::instrument(err, skip(self, caller))]
    async fn get(
        &self,
        caller: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        let (grant, _) = self.load(caller, id).await?;
        Ok(grant)
    }

    #[tracing::instrument(err, skip_all)]
    async fn list_managers(
        &self,
        caller: &MacroUserIdStr<'static>,
    ) -> Result<Vec<AccountManagerGrant>, AccountManagerError> {
        let grants = self.repo.list_for_managed(caller).await.map_err(internal)?;
        let now = Utc::now();
        Ok(grants
            .into_iter()
            .map(|grant| grant.at(now))
            .filter(|grant| grant.status != AccountManagerGrantStatus::Expired)
            .collect())
    }

    #[tracing::instrument(err, skip(self, caller))]
    async fn respond(
        &self,
        caller: &MacroUserIdStr<'static>,
        id: Uuid,
        decision: AccountManagerDecision,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        let (grant, _) = self.load(caller, id).await?;
        if grant.responder().as_ref() != caller.as_ref() {
            return Err(AccountManagerError::Forbidden(
                "only the side that didn't ask can respond",
            ));
        }

        let now = Utc::now();
        let responded = self
            .repo
            .respond(id, decision, now + RESPONSE_WINDOW, now)
            .await
            .map_err(internal)?
            .ok_or(AccountManagerError::Conflict(
                "this request is no longer open",
            ))?;

        if decision == AccountManagerDecision::Approve {
            let recipient = match grant.role_of(caller) {
                Some(AccountManagerRole::Managed) => &responded.manager_user_id,
                _ => &responded.managed_user_id,
            };
            // The approval stands without the message: the card already shows
            // it, and the manager can still claim from there.
            if let Err(error) = self.delivery.deliver_approval(caller, recipient, id).await {
                tracing::warn!(error = ?error, grant_id = %id, "could not post the approval");
            }
        }

        Ok(responded)
    }

    #[tracing::instrument(err, skip(self, caller))]
    async fn claim(
        &self,
        caller: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<ClaimedCredential, AccountManagerError> {
        let (_, role) = self.load(caller, id).await?;
        if role != AccountManagerRole::Manager {
            return Err(AccountManagerError::Forbidden(
                "only the manager can claim this token",
            ));
        }

        let key = UserApiKey::generate();
        let grant = self
            .repo
            .claim(id, &key.hash(), Utc::now())
            .await
            .map_err(internal)?
            .ok_or(AccountManagerError::Conflict(
                "this token link has already been used or expired",
            ))?;

        Ok(ClaimedCredential { grant, key })
    }

    #[tracing::instrument(err, skip(self, caller))]
    async fn revoke(
        &self,
        caller: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<AccountManagerGrant, AccountManagerError> {
        self.load(caller, id).await?;
        self.repo
            .revoke(id)
            .await
            .map_err(internal)?
            .ok_or(AccountManagerError::Conflict(
                "this access has already ended",
            ))
    }
}
