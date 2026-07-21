//! Adapter from the bots domain service to Macro authorization.

#[cfg(test)]
mod test;

use std::sync::Arc;

use macro_authorization::{
    BotActingUserClaims, BotAuthentication, BotAuthorizer, MacroAuthorizationError,
    MacroUserAuthentication,
};
use model_user::UserContext;
use rootcause::Report;

use crate::domain::{
    models::{ActingUser, ActingUserClaims, AuthorizedBotPrincipal},
    ports::{BotError, BotService},
};

/// Implements Macro bot authorization by delegating all grant decisions to a bot service.
#[derive(Clone)]
pub struct BotServiceAuthorizer<S: BotService>(Arc<S>);

impl<S: BotService> BotServiceAuthorizer<S> {
    /// Create an authorizer backed by the supplied bot service.
    pub fn new(service: S) -> Self {
        Self(Arc::new(service))
    }
}

impl<S: BotService> BotAuthorizer for BotServiceAuthorizer<S> {
    async fn authorize_bot(
        &self,
        bot_token: &str,
        acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        let principal = self
            .0
            .authorize_bot_request(bot_token, acting_user.map(acting_user_claims))
            .await
            .map_err(map_authorization_error)?;

        Ok(bot_authentication(principal))
    }
}

fn acting_user_claims(claims: BotActingUserClaims) -> ActingUserClaims {
    ActingUserClaims {
        user_id: claims.user_id,
        fusion_user_id: claims.fusion_user_id,
        organization_id: claims.organization_id,
    }
}

fn bot_authentication(principal: AuthorizedBotPrincipal) -> BotAuthentication {
    BotAuthentication {
        bot_id: principal.bot.bot_id,
        token_id: principal.token_id,
        acting_user: principal.acting_user.map(user_authentication),
    }
}

fn user_authentication(acting_user: ActingUser) -> MacroUserAuthentication {
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

fn map_authorization_error(error: BotError) -> Report<MacroAuthorizationError> {
    let authorization_error = match error {
        BotError::Unauthorized => MacroAuthorizationError::InvalidCredentials,
        BotError::ForbiddenActingUser => MacroAuthorizationError::ActingUserNotAuthorized,
        BotError::Repo(error) => {
            tracing::error!(error=?error, "bot authorization repository failed");
            MacroAuthorizationError::Unavailable
        }
        error @ (BotError::BadRequest(_) | BotError::NotFound(_)) => {
            tracing::error!(error=?error, "bot authorization returned an unexpected domain error");
            MacroAuthorizationError::Unavailable
        }
    };

    Report::new(authorization_error)
}
