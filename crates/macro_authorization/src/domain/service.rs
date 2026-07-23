#[cfg(test)]
mod test;

use std::{future::Future, pin::Pin, sync::Arc};

use constant_time_eq::constant_time_eq;
use model_user::UserContext;
use rootcause::Report;

use super::{
    models::{
        BotActingUserClaims, BotAuthentication, BotScope, InternalAuthConfig,
        InternalIdentityClaims, MacroAuthorizationError,
    },
    ports::{BotAuthorizer, JwtValidator, MacroAuthorizationService},
};

type BotAuthorizationFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<BotAuthentication, Report<MacroAuthorizationError>>> + Send + 'a,
    >,
>;

trait DynBotAuthorizer: Send + Sync {
    fn authorize_bot<'a>(
        &'a self,
        bot_token: &'a str,
        bot_scope: BotScope,
        acting_user: Option<BotActingUserClaims>,
    ) -> BotAuthorizationFuture<'a>;
}

impl<B> DynBotAuthorizer for B
where
    B: BotAuthorizer,
{
    fn authorize_bot<'a>(
        &'a self,
        bot_token: &'a str,
        bot_scope: BotScope,
        acting_user: Option<BotActingUserClaims>,
    ) -> BotAuthorizationFuture<'a> {
        Box::pin(BotAuthorizer::authorize_bot(
            self,
            bot_token,
            bot_scope,
            acting_user,
        ))
    }
}

/// Default authorization service backed by a credential validator.
#[derive(Clone)]
pub struct MacroAuthorizationServiceImpl<V> {
    validator: V,
    internal_auth: InternalAuthConfig,
    bot_authorizer: Arc<dyn DynBotAuthorizer>,
}

impl<V> MacroAuthorizationServiceImpl<V> {
    /// Create an authorization service with required user, internal, and bot authorization dependencies.
    pub fn new(
        validator: V,
        internal_auth: InternalAuthConfig,
        bot_authorizer: impl BotAuthorizer,
    ) -> Self {
        Self {
            validator,
            internal_auth,
            bot_authorizer: Arc::new(bot_authorizer),
        }
    }
}

impl<V> MacroAuthorizationService for MacroAuthorizationServiceImpl<V>
where
    V: JwtValidator,
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
            bot_scope = tracing::field::Empty,
            team_id = tracing::field::Empty,
            acting_user_id = tracing::field::Empty,
        )
    )]
    async fn authorize_bot(
        &self,
        bot_token: &str,
        bot_scope: BotScope,
        acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        let bot = self
            .bot_authorizer
            .authorize_bot(bot_token, bot_scope, acting_user)
            .await?;

        let span = tracing::Span::current();
        span.record("bot_id", tracing::field::display(bot.bot_id));
        span.record("token_id", tracing::field::display(bot.token_id));
        span.record("bot_scope", tracing::field::display(bot.bot_scope));
        if let Some(team_id) = bot.team_id {
            span.record("team_id", tracing::field::display(team_id));
        }
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
