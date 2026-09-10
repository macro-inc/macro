#[cfg(test)]
mod test;

use std::{collections::HashSet, fmt};

use bot_id::BotId;
use harness_id::HarnessId;
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use thiserror::Error;
use uuid::Uuid;

/// A user identity that has been authenticated or verified for a bot.
#[derive(Clone, Debug)]
pub struct MacroUserAuthentication {
    /// The user's parsed Macro identifier.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// The authenticated user context.
    pub user_context: UserContext,
}

/// The access scope selected for a bot-authorized request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BotScope {
    /// Authorize access in the bot's user scope.
    User,
    /// Authorize access in the bot's team scope.
    Team,
}

impl BotScope {
    /// Return the header representation of this scope.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Team => "team",
        }
    }
}

impl fmt::Display for BotScope {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A bot principal whose token has been validated.
///
/// The raw token is deliberately excluded so it cannot flow into handlers,
/// tracing spans, or logs after authentication.
#[derive(Clone, Debug)]
pub struct BotAuthentication {
    /// The validated bot.
    pub bot_id: BotId,
    /// The token row used to authenticate, for audit and telemetry.
    pub token_id: Uuid,
    /// The access scope required by this bot-authorized request.
    pub bot_scope: BotScope,
    /// The bot's owning team for team-owned bots, regardless of the requested scope.
    pub team_id: Option<Uuid>,
    /// The verified acting user, when one was requested and authorized.
    pub acting_user: Option<MacroUserAuthentication>,
}

/// A harness principal whose token has been validated.
///
/// The raw token is deliberately excluded so it cannot flow into handlers,
/// tracing spans, or logs after authentication.
#[derive(Clone, Debug)]
pub struct HarnessAuthentication {
    /// The validated harness.
    pub harness_id: HarnessId,
    /// The token row used to authenticate, for audit and telemetry.
    pub token_id: Uuid,
    /// The harness owner used by acting-user policy.
    pub owner: HarnessAuthorizationOwner,
    /// The verified user this request acts for.
    ///
    /// Always resolved server-side: the claimed user when the daemon forwards
    /// one (a mention sender, verified against harness ownership), otherwise
    /// the harness owner for private harnesses or its creator for team
    /// harnesses. A guaranteed acting user lets acting-user-gated endpoints
    /// (webhook feed registration) admit harness callers unchanged.
    pub acting_user: MacroUserAuthentication,
}

/// How the caller authenticated.
///
/// This enum is exhaustive so adding an authentication source requires every
/// authorization decision to account for it explicitly.
#[derive(Clone, Debug)]
pub enum MacroAuthorization {
    /// A caller authenticated directly with user credentials.
    User(MacroUserAuthentication),
    /// A caller authenticated with a bot token.
    Bot(BotAuthentication),
    /// A caller authenticated with a harness token.
    Harness(HarnessAuthentication),
    /// An internally authenticated service, optionally acting for a user.
    Internal(Option<MacroUserAuthentication>),
}

impl MacroAuthorization {
    /// Return the authenticated or verified user the caller is acting for.
    pub fn acting_user(&self) -> Option<&MacroUserAuthentication> {
        match self {
            Self::User(user) => Some(user),
            Self::Bot(bot) => bot.acting_user.as_ref(),
            Self::Harness(harness) => Some(&harness.acting_user),
            Self::Internal(user) => user.as_ref(),
        }
    }

    /// Return whether the caller authenticated as an internal service.
    pub fn is_internal(&self) -> bool {
        matches!(self, Self::Internal(_))
    }

    /// Return the authenticated bot principal, when the caller is a bot.
    pub fn bot(&self) -> Option<&BotAuthentication> {
        match self {
            Self::Bot(bot) => Some(bot),
            Self::User(_) | Self::Harness(_) | Self::Internal(_) => None,
        }
    }

    /// Return the authenticated harness principal, when the caller is a harness.
    pub fn harness(&self) -> Option<&HarnessAuthentication> {
        match self {
            Self::Harness(harness) => Some(harness),
            Self::User(_) | Self::Bot(_) | Self::Internal(_) => None,
        }
    }
}

/// Ownership facts for a bot whose token has been validated.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BotAuthorizationOwner {
    /// A bot owned by one Macro user.
    User {
        /// The owning Macro user identifier.
        user_id: String,
    },
    /// A bot owned by a team.
    Team {
        /// The owning team identifier.
        team_id: Uuid,
    },
    /// A first-party system bot with no user or team owner.
    System,
}

/// Ownership facts for a harness whose token has been validated.
///
/// Unlike bots, a harness always has a user or team owner; there are no
/// system harnesses.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum HarnessAuthorizationOwner {
    /// A harness owned by one Macro user.
    User {
        /// The owning Macro user identifier.
        user_id: String,
    },
    /// A harness owned by a team.
    Team {
        /// The owning team identifier.
        team_id: Uuid,
    },
}

/// Valid harness-token facts returned by the authorization repository.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct HarnessTokenAuthorization {
    /// The authenticated harness.
    pub harness_id: HarnessId,
    /// The token row used to authenticate.
    pub token_id: Uuid,
    /// The harness owner used by acting-user policy.
    pub owner: HarnessAuthorizationOwner,
    /// The Macro user id that registered the harness.
    ///
    /// The default acting user for team-owned harnesses.
    pub created_by: String,
}

/// Valid bot-token facts returned by the authorization repository.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BotTokenAuthorization {
    /// The authenticated bot.
    pub bot_id: BotId,
    /// The token row used to authenticate.
    pub token_id: Uuid,
    /// The bot owner used by acting-user policy.
    pub owner: BotAuthorizationOwner,
}

/// Acting-user facts resolved from the user store.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedBotActingUser {
    /// The user's parsed Macro identifier.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// The user's FusionAuth identifier.
    pub fusion_user_id: String,
    /// The user's organization, when present.
    pub organization_id: Option<i32>,
}

/// User identity facts resolved for a valid user API key.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ResolvedApiKeyUser {
    /// The user's parsed Macro identifier.
    pub macro_user_id: MacroUserIdStr<'static>,
    /// The user's FusionAuth identifier.
    pub fusion_user_id: String,
    /// The user's organization, when present.
    pub organization_id: Option<i32>,
}

/// Unverified acting-user claims presented by a bot.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct BotActingUserClaims {
    /// The claimed Macro user identifier.
    pub user_id: Option<String>,
    /// The claimed FusionAuth user identifier.
    pub fusion_user_id: Option<String>,
    /// The claimed organization identifier.
    pub organization_id: Option<i32>,
}

/// Identity claims presented by an internally authenticated caller.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct InternalIdentityClaims {
    /// The acting user's Macro identifier, when the caller acts on a user's behalf.
    pub user_id: Option<String>,
    /// The acting user's FusionAuth identifier.
    pub fusion_user_id: Option<String>,
    /// The acting user's organization.
    pub organization_id: Option<i32>,
}

/// Configuration enabling internal service-to-service authorization.
#[derive(Clone)]
pub struct InternalAuthConfig {
    /// The shared secret internal callers must present.
    pub api_key: String,
    /// Identity assumed for internal callers that supply no acting user.
    pub default_user_id: Option<String>,
}

/// An identity whose credential has already passed cryptographic validation.
///
/// Validation adapters construct this value without exposing token claim types
/// to the authorization service.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ValidatedIdentity {
    /// The user's Macro identifier.
    pub user_id: String,
    /// The user's FusionAuth or root identifier.
    pub fusion_user_id: String,
    /// The organization the user belongs to, when present.
    pub organization_id: Option<i32>,
    /// Permissions established while validating or enriching the identity.
    pub permissions: Option<HashSet<String>>,
}

/// Errors returned when a credential cannot authorize a caller.
///
/// The variants deliberately omit validation implementation details so callers
/// can handle authorization failures without exposing sensitive information.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MacroAuthorizationError {
    /// The supplied credential was valid but has expired.
    #[error("credentials expired")]
    CredentialsExpired,
    /// The supplied credential is otherwise invalid.
    #[error("invalid credentials")]
    InvalidCredentials,
    /// The authenticated bot is not authorized to act for the claimed user.
    #[error("acting user not authorized")]
    ActingUserNotAuthorized,
    /// The authenticated bot cannot use the requested access scope.
    #[error("bot scope not authorized")]
    BotScopeNotAuthorized,
    /// Authorization could not be completed because a required service failed.
    #[error("authorization unavailable")]
    Unavailable,
}
