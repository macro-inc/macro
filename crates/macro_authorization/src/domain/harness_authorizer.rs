//! Harness credential authorization policy.

#[cfg(test)]
mod test;

use model_user::UserContext;
use rootcause::Report;

use super::{
    models::{
        HarnessAuthentication, HarnessAuthorizationOwner, HarnessTokenAuthorization,
        MacroAuthorizationError, MacroUserAuthentication, ResolvedBotActingUser,
    },
    ports::{HarnessAuthorizationRepo, HarnessAuthorizer},
};

/// Harness authorizer backed by transport-independent authorization facts.
#[derive(Clone, Debug)]
pub struct HarnessAuthorizerService<R> {
    repo: R,
}

impl<R> HarnessAuthorizerService<R> {
    /// Create a harness authorizer backed by the supplied repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> HarnessAuthorizerService<R>
where
    R: HarnessAuthorizationRepo,
{
    /// Resolve and verify the user this harness request acts for.
    ///
    /// A forwarded claim must be authorized against harness ownership: the
    /// owner for private harnesses, any current team member for team-owned
    /// ones. The default (owner or creator) passes the same check so a
    /// creator who left the owning team no longer authenticates its harness.
    async fn resolve_acting_user(
        &self,
        token: &HarnessTokenAuthorization,
        claim: Option<String>,
    ) -> Result<ResolvedBotActingUser, Report<MacroAuthorizationError>> {
        let user_id = claim.unwrap_or_else(|| match &token.owner {
            HarnessAuthorizationOwner::User { user_id } => user_id.clone(),
            HarnessAuthorizationOwner::Team { .. } => token.created_by.clone(),
        });

        let acting_user = self
            .repo
            .find_user(&user_id)
            .await
            .map_err(|error| repository_error(error, "find harness acting user"))?
            .ok_or_else(|| Report::new(MacroAuthorizationError::ActingUserNotAuthorized))?;

        let authorized = match &token.owner {
            HarnessAuthorizationOwner::User { user_id: owner } => {
                owner == acting_user.macro_user_id.as_ref()
            }
            HarnessAuthorizationOwner::Team { team_id } => self
                .repo
                .user_has_team(&acting_user.fusion_user_id, *team_id)
                .await
                .map_err(|error| repository_error(error, "check harness team membership"))?,
        };

        if !authorized {
            return Err(Report::new(
                MacroAuthorizationError::ActingUserNotAuthorized,
            ));
        }

        Ok(acting_user)
    }
}

impl<R> HarnessAuthorizer for HarnessAuthorizerService<R>
where
    R: HarnessAuthorizationRepo,
{
    async fn authorize_harness(
        &self,
        harness_token: &str,
        acting_user_claim: Option<String>,
    ) -> Result<HarnessAuthentication, Report<MacroAuthorizationError>> {
        let token = self
            .repo
            .find_valid_harness_token(harness_token)
            .await
            .map_err(|error| repository_error(error, "find valid harness token"))?
            .ok_or_else(|| Report::new(MacroAuthorizationError::InvalidCredentials))?;

        self.repo
            .mark_harness_token_used(token.token_id)
            .await
            .map_err(|error| repository_error(error, "mark harness token used"))?;

        let acting_user = self.resolve_acting_user(&token, acting_user_claim).await?;

        Ok(HarnessAuthentication {
            harness_id: token.harness_id,
            token_id: token.token_id,
            owner: token.owner,
            acting_user: user_authentication(acting_user),
        })
    }
}

fn user_authentication(acting_user: ResolvedBotActingUser) -> MacroUserAuthentication {
    let user_id = acting_user.macro_user_id.as_ref().to_owned();
    MacroUserAuthentication {
        macro_user_id: acting_user.macro_user_id,
        user_context: UserContext {
            user_id,
            fusion_user_id: acting_user.fusion_user_id,
            permissions: None,
            organization_id: acting_user.organization_id,
        },
    }
}

fn repository_error(
    error: impl std::fmt::Debug,
    operation: &'static str,
) -> Report<MacroAuthorizationError> {
    tracing::error!(error=?error, operation, "harness authorization repository failed");
    Report::new(MacroAuthorizationError::Unavailable)
}
