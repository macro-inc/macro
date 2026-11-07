//! User API key credential authorization policy.

#[cfg(test)]
mod test;

use model_user::UserContext;
use rootcause::Report;
use tracing::Level;

use super::{
    models::{AuthorizedUserApiKey, MacroAuthorizationError, ResolvedApiKeyUser},
    ports::{UserApiKeyAuthorizationRepo, UserApiKeyAuthorizer},
};

/// User API key authorizer backed by transport-independent authorization facts.
#[derive(Clone, Debug)]
pub struct UserApiKeyAuthorizerService<R> {
    repo: R,
}

impl<R> UserApiKeyAuthorizerService<R> {
    /// Create a user API key authorizer backed by the supplied repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> UserApiKeyAuthorizer for UserApiKeyAuthorizerService<R>
where
    R: UserApiKeyAuthorizationRepo,
{
    #[tracing::instrument(
        err(level = Level::DEBUG),
        skip_all,
        fields(account_manager_grant_id = tracing::field::Empty)
    )]
    async fn authorize_user_api_key(
        &self,
        api_key: &str,
    ) -> Result<AuthorizedUserApiKey, Report<MacroAuthorizationError>> {
        let owner = self
            .repo
            .find_key_owner(api_key)
            .await
            .map_err(|error| repository_error(error, "find key owner"))?
            .ok_or_else(|| Report::new(MacroAuthorizationError::InvalidCredentials))?;

        if let Some(manager) = &owner.account_manager {
            tracing::Span::current().record(
                "account_manager_grant_id",
                tracing::field::display(manager.grant_id),
            );
            self.repo
                .mark_account_manager_grant_used(manager.grant_id)
                .await
                .map_err(|error| repository_error(error, "mark account manager grant used"))?;
        }

        Ok(AuthorizedUserApiKey {
            account_manager: owner.account_manager.clone(),
            user_context: user_context(owner),
        })
    }
}

fn user_context(owner: ResolvedApiKeyUser) -> UserContext {
    UserContext {
        user_id: owner.macro_user_id.as_ref().to_owned(),
        fusion_user_id: owner.fusion_user_id,
        permissions: None,
        organization_id: owner.organization_id,
    }
}

fn repository_error(
    error: impl std::fmt::Debug,
    operation: &'static str,
) -> Report<MacroAuthorizationError> {
    tracing::error!(
        error=?error,
        operation,
        "user api key authorization repository failed"
    );
    Report::new(MacroAuthorizationError::Unavailable)
}
