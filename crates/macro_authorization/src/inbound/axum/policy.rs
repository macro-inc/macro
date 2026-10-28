use std::fmt;

use ::axum::http::StatusCode;
use bot_id::BotId;
use harness_id::HarnessId;

use crate::{
    BotAuthentication, HarnessAuthentication, MacroAuthorization, MacroUserAuthentication,
};

use super::{ActingEntity, MacroAuthorizationRejection, rejection, status_rejection};

/// An endpoint's authorization policy: which authenticated principals the
/// endpoint admits and the narrowed authorization type its handler receives.
///
/// This trait is sealed because policies are security-relevant and are defined
/// only in this crate.
pub trait AuthorizationPolicy: sealed::Sealed + Send + Sync + 'static {
    /// The narrowed authorization carried by the extractor.
    type Output: Clone + Send + Sync + 'static;

    /// The typed authenticated entity responsible for a request, borrowed from
    /// [`Self::Output`].
    type ActingEntity<'a>: Copy + fmt::Debug + fmt::Display;

    /// Validate an authenticated principal against the policy and narrow it.
    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection>;

    /// Derive the authenticated entity from the narrowed authorization.
    fn acting_entity(output: &Self::Output) -> Self::ActingEntity<'_>;
}

/// Admits directly authenticated users and internal services acting for a user.
pub struct UserOrInternal;

/// Admits directly authenticated users and all internal services.
pub struct UserOrInternalService;

/// Admits any principal with a verified acting user.
pub struct ActingUser;

/// Admits only directly authenticated users.
pub struct UserOnly;

/// Admits directly authenticated users and authenticated bots.
pub struct UserOrBot;

/// Admits only authenticated bots.
pub struct BotOnly;

/// Admits only authenticated harnesses.
pub struct HarnessOnly;

/// Admits directly authenticated users, bots, and harnesses.
pub struct UserBotOrHarness;

/// Admits only authenticated internal services.
pub struct InternalOnly;

/// Admits every authenticated principal.
pub struct AnyPrincipal;

/// The credential kind that established a [`UserOrInternal`] acting user.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UserOrInternalCaller {
    /// The user authenticated directly.
    User,
    /// An internal service acted for the user.
    Internal,
}

/// A guaranteed acting user, established by direct user or internal credentials.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct UserOrInternalAuthorization {
    /// The verified acting user.
    pub user: MacroUserAuthentication,
    /// How the acting user was established.
    pub caller: UserOrInternalCaller,
}

/// A user or internal service; internal callers need not act for a user.
///
/// This is the policy output for receipt-minting infrastructure that must keep
/// supporting identityless internal callers and must itself decide what an
/// absent user means.
#[derive(Clone, Debug)]
pub enum UserOrInternalServiceAuthorization {
    /// A directly authenticated user.
    User(MacroUserAuthentication),
    /// An internal service, optionally acting for a user.
    Internal(Option<MacroUserAuthentication>),
}

impl UserOrInternalServiceAuthorization {
    /// Return the authenticated or verified user the caller acts for, if any.
    pub fn acting_user(&self) -> Option<&MacroUserAuthentication> {
        match self {
            Self::User(user) => Some(user),
            Self::Internal(user) => user.as_ref(),
        }
    }

    /// Return whether the caller is an internal service.
    pub fn is_internal(&self) -> bool {
        matches!(self, Self::Internal(_))
    }
}

/// A directly authenticated user or bot.
#[derive(Clone, Debug)]
pub enum UserOrBotAuthorization {
    /// A directly authenticated user.
    User(MacroUserAuthentication),
    /// An authenticated bot, optionally acting for a user.
    Bot(BotAuthentication),
}

impl UserOrBotAuthorization {
    /// Return the authenticated or verified user the caller acts for, if any.
    pub fn acting_user(&self) -> Option<&MacroUserAuthentication> {
        match self {
            Self::User(user) => Some(user),
            Self::Bot(bot) => bot.acting_user.as_ref(),
        }
    }

    /// Return whether the caller is a bot.
    pub fn is_bot(&self) -> bool {
        matches!(self, Self::Bot(_))
    }
}

/// A directly authenticated user, bot, or harness.
#[derive(Clone, Debug)]
pub enum UserBotOrHarnessAuthorization {
    /// A directly authenticated user.
    User(MacroUserAuthentication),
    /// An authenticated bot, optionally acting for a user.
    Bot(BotAuthentication),
    /// An authenticated harness, acting for its verified user.
    Harness(HarnessAuthentication),
}

impl UserBotOrHarnessAuthorization {
    /// Return the authenticated or verified user the caller acts for, if any.
    pub fn acting_user(&self) -> Option<&MacroUserAuthentication> {
        match self {
            Self::User(user) => Some(user),
            Self::Bot(bot) => bot.acting_user.as_ref(),
            Self::Harness(harness) => Some(&harness.acting_user),
        }
    }
}

/// Acting entity for policies that admit users, bots, and harnesses.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UserBotOrHarnessEntity<'a> {
    /// A directly authenticated Macro user.
    User(&'a str),
    /// An authenticated bot.
    Bot(BotId),
    /// An authenticated harness.
    Harness(HarnessId),
}

impl fmt::Display for UserBotOrHarnessEntity<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::User(user_id) => formatter.write_str(user_id),
            Self::Bot(bot_id) => bot_id.fmt(formatter),
            Self::Harness(harness_id) => harness_id.fmt(formatter),
        }
    }
}

/// Any principal narrowed to its verified acting user.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct ActingUserAuthorization {
    /// The full authenticating principal.
    pub principal: MacroAuthorization,
    /// The verified acting user.
    pub user: MacroUserAuthentication,
}

/// An internal service caller.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct InternalAuthorization {
    /// The acting user verified from identity headers, if one was supplied or
    /// configured as the internal default.
    pub acting_user: Option<MacroUserAuthentication>,
}

/// Acting entity for policies that admit users and internal services.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UserOrInternalEntity<'a> {
    /// A directly authenticated Macro user.
    User(&'a str),
    /// An authenticated internal service.
    Internal,
}

impl fmt::Display for UserOrInternalEntity<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::User(user_id) => formatter.write_str(user_id),
            Self::Internal => formatter.write_str("internal"),
        }
    }
}

/// Acting entity for policies that admit users and bots.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum UserOrBotEntity<'a> {
    /// A directly authenticated Macro user.
    User(&'a str),
    /// An authenticated bot.
    Bot(BotId),
}

impl fmt::Display for UserOrBotEntity<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::User(user_id) => formatter.write_str(user_id),
            Self::Bot(bot_id) => bot_id.fmt(formatter),
        }
    }
}

/// Acting entity for internal-only endpoints.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InternalEntity;

impl fmt::Display for InternalEntity {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("internal")
    }
}

impl AuthorizationPolicy for UserOrInternal {
    type Output = UserOrInternalAuthorization;
    type ActingEntity<'a> = UserOrInternalEntity<'a>;

    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection> {
        match authorization {
            MacroAuthorization::User(user) => Ok(UserOrInternalAuthorization {
                user,
                caller: UserOrInternalCaller::User,
            }),
            MacroAuthorization::Internal(Some(user)) => Ok(UserOrInternalAuthorization {
                user,
                caller: UserOrInternalCaller::Internal,
            }),
            MacroAuthorization::Internal(None) => Err(rejection("unauthorized")),
            MacroAuthorization::Bot(_) | MacroAuthorization::Harness(_) => Err(forbidden()),
        }
    }

    fn acting_entity(output: &Self::Output) -> Self::ActingEntity<'_> {
        match output.caller {
            UserOrInternalCaller::User => {
                UserOrInternalEntity::User(output.user.macro_user_id.as_ref())
            }
            UserOrInternalCaller::Internal => UserOrInternalEntity::Internal,
        }
    }
}

impl AuthorizationPolicy for UserOrInternalService {
    type Output = UserOrInternalServiceAuthorization;
    type ActingEntity<'a> = UserOrInternalEntity<'a>;

    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection> {
        match authorization {
            MacroAuthorization::User(user) => Ok(UserOrInternalServiceAuthorization::User(user)),
            MacroAuthorization::Internal(user) => {
                Ok(UserOrInternalServiceAuthorization::Internal(user))
            }
            MacroAuthorization::Bot(_) | MacroAuthorization::Harness(_) => Err(forbidden()),
        }
    }

    fn acting_entity(output: &Self::Output) -> Self::ActingEntity<'_> {
        match output {
            UserOrInternalServiceAuthorization::User(user) => {
                UserOrInternalEntity::User(user.macro_user_id.as_ref())
            }
            UserOrInternalServiceAuthorization::Internal(_) => UserOrInternalEntity::Internal,
        }
    }
}

impl AuthorizationPolicy for ActingUser {
    type Output = ActingUserAuthorization;
    type ActingEntity<'a> = ActingEntity<'a>;

    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection> {
        let user = authorization
            .acting_user()
            .cloned()
            .ok_or_else(|| rejection("unauthorized"))?;

        Ok(ActingUserAuthorization {
            principal: authorization,
            user,
        })
    }

    fn acting_entity(output: &Self::Output) -> Self::ActingEntity<'_> {
        ActingEntity::from(&output.principal)
    }
}

impl AuthorizationPolicy for UserOnly {
    type Output = MacroUserAuthentication;
    type ActingEntity<'a> = &'a str;

    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection> {
        match authorization {
            MacroAuthorization::User(user) => Ok(user),
            MacroAuthorization::Bot(_)
            | MacroAuthorization::Harness(_)
            | MacroAuthorization::Internal(_) => Err(forbidden()),
        }
    }

    fn acting_entity(output: &Self::Output) -> Self::ActingEntity<'_> {
        output.macro_user_id.as_ref()
    }
}

impl AuthorizationPolicy for UserOrBot {
    type Output = UserOrBotAuthorization;
    type ActingEntity<'a> = UserOrBotEntity<'a>;

    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection> {
        match authorization {
            MacroAuthorization::User(user) => Ok(UserOrBotAuthorization::User(user)),
            MacroAuthorization::Bot(bot) => Ok(UserOrBotAuthorization::Bot(bot)),
            MacroAuthorization::Harness(_) | MacroAuthorization::Internal(_) => Err(forbidden()),
        }
    }

    fn acting_entity(output: &Self::Output) -> Self::ActingEntity<'_> {
        match output {
            UserOrBotAuthorization::User(user) => {
                UserOrBotEntity::User(user.macro_user_id.as_ref())
            }
            UserOrBotAuthorization::Bot(bot) => UserOrBotEntity::Bot(bot.bot_id),
        }
    }
}

impl AuthorizationPolicy for BotOnly {
    type Output = BotAuthentication;
    type ActingEntity<'a> = BotId;

    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection> {
        match authorization {
            MacroAuthorization::Bot(bot) => Ok(bot),
            MacroAuthorization::User(_)
            | MacroAuthorization::Harness(_)
            | MacroAuthorization::Internal(_) => Err(forbidden()),
        }
    }

    fn acting_entity(output: &Self::Output) -> Self::ActingEntity<'_> {
        output.bot_id
    }
}

impl AuthorizationPolicy for HarnessOnly {
    type Output = HarnessAuthentication;
    type ActingEntity<'a> = HarnessId;

    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection> {
        match authorization {
            MacroAuthorization::Harness(harness) => Ok(harness),
            MacroAuthorization::User(_)
            | MacroAuthorization::Bot(_)
            | MacroAuthorization::Internal(_) => Err(forbidden()),
        }
    }

    fn acting_entity(output: &Self::Output) -> Self::ActingEntity<'_> {
        output.harness_id
    }
}

impl AuthorizationPolicy for UserBotOrHarness {
    type Output = UserBotOrHarnessAuthorization;
    type ActingEntity<'a> = UserBotOrHarnessEntity<'a>;

    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection> {
        match authorization {
            MacroAuthorization::User(user) => Ok(UserBotOrHarnessAuthorization::User(user)),
            MacroAuthorization::Bot(bot) => Ok(UserBotOrHarnessAuthorization::Bot(bot)),
            MacroAuthorization::Harness(harness) => {
                Ok(UserBotOrHarnessAuthorization::Harness(harness))
            }
            MacroAuthorization::Internal(_) => Err(forbidden()),
        }
    }

    fn acting_entity(output: &Self::Output) -> Self::ActingEntity<'_> {
        match output {
            UserBotOrHarnessAuthorization::User(user) => {
                UserBotOrHarnessEntity::User(user.macro_user_id.as_ref())
            }
            UserBotOrHarnessAuthorization::Bot(bot) => UserBotOrHarnessEntity::Bot(bot.bot_id),
            UserBotOrHarnessAuthorization::Harness(harness) => {
                UserBotOrHarnessEntity::Harness(harness.harness_id)
            }
        }
    }
}

impl AuthorizationPolicy for InternalOnly {
    type Output = InternalAuthorization;
    type ActingEntity<'a> = InternalEntity;

    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection> {
        match authorization {
            MacroAuthorization::Internal(acting_user) => Ok(InternalAuthorization { acting_user }),
            MacroAuthorization::User(_)
            | MacroAuthorization::Bot(_)
            | MacroAuthorization::Harness(_) => Err(forbidden()),
        }
    }

    fn acting_entity(_output: &Self::Output) -> Self::ActingEntity<'_> {
        InternalEntity
    }
}

impl AuthorizationPolicy for AnyPrincipal {
    type Output = MacroAuthorization;
    type ActingEntity<'a> = ActingEntity<'a>;

    fn narrow(
        authorization: MacroAuthorization,
    ) -> Result<Self::Output, MacroAuthorizationRejection> {
        Ok(authorization)
    }

    fn acting_entity(output: &Self::Output) -> Self::ActingEntity<'_> {
        ActingEntity::from(output)
    }
}

fn forbidden() -> MacroAuthorizationRejection {
    status_rejection(StatusCode::FORBIDDEN, "forbidden")
}

mod sealed {
    pub trait Sealed {}

    impl Sealed for super::UserOrInternal {}
    impl Sealed for super::UserOrInternalService {}
    impl Sealed for super::ActingUser {}
    impl Sealed for super::UserOnly {}
    impl Sealed for super::UserOrBot {}
    impl Sealed for super::BotOnly {}
    impl Sealed for super::HarnessOnly {}
    impl Sealed for super::UserBotOrHarness {}
    impl Sealed for super::InternalOnly {}
    impl Sealed for super::AnyPrincipal {}
}
