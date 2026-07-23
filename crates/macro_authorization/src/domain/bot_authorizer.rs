//! Bot credential authorization policy.

#[cfg(test)]
mod test;

use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;

use super::{
    models::{
        BotActingUserClaims, BotAuthentication, BotAuthorizationOwner, BotScope,
        BotTokenAuthorization, MacroAuthorizationError, MacroUserAuthentication,
        ResolvedBotActingUser,
    },
    ports::{BotAuthorizationRepo, BotAuthorizer},
};

/// Bot authorizer backed by transport-independent authorization facts.
#[derive(Clone, Debug)]
pub struct BotAuthorizerService<R> {
    repo: R,
}

impl<R> BotAuthorizerService<R> {
    /// Create a bot authorizer backed by the supplied repository.
    pub fn new(repo: R) -> Self {
        Self { repo }
    }
}

impl<R> BotAuthorizerService<R>
where
    R: BotAuthorizationRepo,
{
    async fn resolve_acting_user(
        &self,
        token: &BotTokenAuthorization,
        claims: &BotActingUserClaims,
    ) -> Result<ResolvedBotActingUser, Report<MacroAuthorizationError>> {
        if claims.user_id.is_none() && claims.fusion_user_id.is_none() {
            return Err(Report::new(
                MacroAuthorizationError::ActingUserNotAuthorized,
            ));
        }

        let claimed_macro_user_id = claims
            .user_id
            .as_deref()
            .map(MacroUserIdStr::parse_from_str)
            .transpose()
            .map_err(|_| Report::new(MacroAuthorizationError::ActingUserNotAuthorized))?;

        if token.owner == BotAuthorizationOwner::System {
            return Err(Report::new(
                MacroAuthorizationError::ActingUserNotAuthorized,
            ));
        }

        let acting_user = self
            .repo
            .find_acting_user(claims)
            .await
            .map_err(|error| repository_error(error, "find acting user"))?
            .ok_or_else(|| Report::new(MacroAuthorizationError::ActingUserNotAuthorized))?;

        let macro_user_id_matches = claimed_macro_user_id
            .as_ref()
            .is_none_or(|claimed| claimed.as_ref() == acting_user.macro_user_id.as_ref());
        let fusion_user_id_matches = claims
            .fusion_user_id
            .as_deref()
            .is_none_or(|claimed| claimed == acting_user.fusion_user_id);
        let organization_id_matches = claims
            .organization_id
            .is_none_or(|claimed| Some(claimed) == acting_user.organization_id);

        if !macro_user_id_matches || !fusion_user_id_matches || !organization_id_matches {
            return Err(Report::new(
                MacroAuthorizationError::ActingUserNotAuthorized,
            ));
        }

        let authorized = match &token.owner {
            BotAuthorizationOwner::User { user_id } => {
                user_id == acting_user.macro_user_id.as_ref()
            }
            BotAuthorizationOwner::Team { team_id } => self
                .repo
                .user_has_team(&acting_user.fusion_user_id, *team_id)
                .await
                .map_err(|error| repository_error(error, "check bot owner team membership"))?,
            BotAuthorizationOwner::System => false,
        };

        if !authorized {
            return Err(Report::new(
                MacroAuthorizationError::ActingUserNotAuthorized,
            ));
        }

        Ok(acting_user)
    }
}

impl<R> BotAuthorizer for BotAuthorizerService<R>
where
    R: BotAuthorizationRepo,
{
    async fn authorize_bot(
        &self,
        bot_token: &str,
        bot_scope: BotScope,
        acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        let token = self
            .repo
            .find_valid_bot_token(bot_token)
            .await
            .map_err(|error| repository_error(error, "find valid bot token"))?
            .ok_or_else(|| Report::new(MacroAuthorizationError::InvalidCredentials))?;

        self.repo
            .mark_token_used(token.token_id)
            .await
            .map_err(|error| repository_error(error, "mark bot token used"))?;

        let team_id = match &token.owner {
            BotAuthorizationOwner::Team { team_id } => Some(*team_id),
            BotAuthorizationOwner::User { .. } | BotAuthorizationOwner::System => None,
        };
        if bot_scope == BotScope::Team && team_id.is_none() {
            return Err(Report::new(MacroAuthorizationError::BotScopeNotAuthorized));
        }

        let acting_user = match acting_user {
            Some(claims) => Some(user_authentication(
                self.resolve_acting_user(&token, &claims).await?,
            )),
            None => None,
        };

        Ok(BotAuthentication {
            bot_id: token.bot_id,
            token_id: token.token_id,
            bot_scope,
            team_id,
            acting_user,
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
    tracing::error!(error=?error, operation, "bot authorization repository failed");
    Report::new(MacroAuthorizationError::Unavailable)
}
