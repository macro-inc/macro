#[cfg(test)]
mod test;

use constant_time_eq::constant_time_eq;
use model_user::UserContext;
use rootcause::Report;

use super::{
    models::{
        BotActingUserClaims, BotAuthentication, InternalAuthConfig, InternalIdentityClaims,
        MacroAuthorizationError,
    },
    ports::{BotAuthorizer, JwtValidator, MacroAuthorizationService, NoBotAuthorizer},
};

/// Default authorization service backed by a credential validator.
#[derive(Clone)]
pub struct MacroAuthorizationServiceImpl<V, B = NoBotAuthorizer> {
    validator: V,
    internal_auth: InternalAuthConfig,
    bot_authorizer: B,
}

impl<V> MacroAuthorizationServiceImpl<V, NoBotAuthorizer> {
    /// Create an authorization service using the supplied validator and required internal authorization configuration.
    pub fn new(validator: V, internal_auth: InternalAuthConfig) -> Self {
        Self {
            validator,
            internal_auth,
            bot_authorizer: NoBotAuthorizer,
        }
    }
}

impl<V, B> MacroAuthorizationServiceImpl<V, B> {
    /// Replace the bot authorizer while preserving user and internal authorization configuration.
    pub fn with_bot_authorizer<B2>(
        self,
        bot_authorizer: B2,
    ) -> MacroAuthorizationServiceImpl<V, B2> {
        MacroAuthorizationServiceImpl {
            validator: self.validator,
            internal_auth: self.internal_auth,
            bot_authorizer,
        }
    }
}

impl<V, B> MacroAuthorizationService for MacroAuthorizationServiceImpl<V, B>
where
    V: JwtValidator,
    B: BotAuthorizer,
{
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        let identity = self.validator.validate(jwt)?;

        Ok(UserContext {
            user_id: identity.user_id,
            fusion_user_id: identity.fusion_user_id,
            permissions: identity.permissions,
            organization_id: identity.organization_id,
        })
    }

    #[tracing::instrument(
        err,
        skip_all,
        fields(
            bot_id = tracing::field::Empty,
            token_id = tracing::field::Empty,
            acting_user_id = tracing::field::Empty,
        )
    )]
    async fn authorize_bot(
        &self,
        bot_token: &str,
        acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        let bot = self
            .bot_authorizer
            .authorize_bot(bot_token, acting_user)
            .await?;

        let span = tracing::Span::current();
        span.record("bot_id", tracing::field::display(bot.bot_id));
        span.record("token_id", tracing::field::display(bot.token_id));
        if let Some(acting_user) = &bot.acting_user {
            span.record(
                "acting_user_id",
                tracing::field::display(&acting_user.macro_user_id),
            );
        }

        Ok(bot)
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if !constant_time_eq(
            provided_key.as_bytes(),
            self.internal_auth.api_key.as_bytes(),
        ) {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        let Some(user_id) = claims
            .user_id
            .or_else(|| self.internal_auth.default_user_id.clone())
        else {
            return Ok(None);
        };

        Ok(Some(UserContext {
            user_id,
            fusion_user_id: claims.fusion_user_id.unwrap_or_default(),
            permissions: None,
            organization_id: claims.organization_id,
        }))
    }
}
