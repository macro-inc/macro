//! User API key credential authorization policy.

#[cfg(test)]
mod test;

use model_user::UserContext;
use rootcause::Report;

use super::{
    models::{MacroAuthorizationError, ResolvedApiKeyUser},
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
    #[tracing::instrument(err, skip_all)]
    async fn authorize_user_api_key(
        &self,
        api_key: &str,
    ) -> Result<UserContext, Report<MacroAuthorizationError>> {
        let owner = self
            .repo
            .find_key_owner(api_key)
            .await
            .map_err(|error| repository_error(error, "find key owner"))?
            .ok_or_else(|| Report::new(MacroAuthorizationError::InvalidCredentials))?;

        Ok(user_context(owner))
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
