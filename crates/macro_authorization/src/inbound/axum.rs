#[cfg(test)]
mod test;

mod bot;
mod harness;
mod internal;
mod macro_authorization;
mod optional;
mod policy;
mod user;
mod user_api_key;

use std::{borrow::Cow, fmt, sync::Arc};

use ::axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use bot_id::BotId;
use harness_id::HarnessId;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_error_response::ErrorResponse;
use model_user::UserContext;

use crate::{MacroAuthorization, MacroUserAuthentication};

pub use bot::{
    BOT_FOR_FUSIONAUTH_USER_ID_HEADER, BOT_FOR_MACRO_USER_ID_HEADER,
    BOT_FOR_ORGANIZATION_ID_HEADER, BOT_SCOPE_HEADER, BOT_TOKEN_HEADER,
};
pub use harness::{HARNESS_FOR_MACRO_USER_ID_HEADER, HARNESS_TOKEN_HEADER};
#[allow(deprecated)]
pub use internal::{
    INTERNAL_API_KEY_HEADER, INTERNAL_FUSIONAUTH_USER_ID_HEADER,
    INTERNAL_MACRO_ORGANIZATION_ID_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
    LEGACY_DSS_INTERNAL_API_KEY_HEADER, LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER,
};
pub use macro_authorization::MacroAuthorizationExtractor;
pub use optional::OptionalMacroAuthorizationExtractor;
pub use policy::{
    ActingUser, ActingUserAuthorization, AnyPrincipal, AuthorizationPolicy, BotOnly, HarnessOnly,
    InternalAuthorization, InternalEntity, InternalOnly, UserBotOrHarness,
    UserBotOrHarnessAuthorization, UserBotOrHarnessEntity, UserOnly, UserOrBot,
    UserOrBotAuthorization, UserOrBotEntity, UserOrInternal, UserOrInternalAuthorization,
    UserOrInternalCaller, UserOrInternalEntity, UserOrInternalService,
    UserOrInternalServiceAuthorization,
};
pub use user_api_key::USER_API_KEY_HEADER;

/// The authenticated entity responsible for a request.
///
/// This intentionally identifies the authenticating principal rather than an
/// acting user. A bot acting for a user is attributed to the bot, and an
/// internal service acting for a user is attributed to the internal service.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActingEntity<'a> {
    /// A directly authenticated bot.
    Bot(BotId),
    /// A directly authenticated harness.
    Harness(HarnessId),
    /// A directly authenticated Macro user.
    User(&'a str),
    /// An authenticated internal service.
    Internal,
}

impl<'a> From<&'a MacroAuthorization> for ActingEntity<'a> {
    fn from(authorization: &'a MacroAuthorization) -> Self {
        match authorization {
            MacroAuthorization::User(user) => Self::User(user.macro_user_id.as_ref()),
            MacroAuthorization::Bot(bot) => Self::Bot(bot.bot_id),
            MacroAuthorization::Harness(harness) => Self::Harness(harness.harness_id),
            MacroAuthorization::Internal(_) => Self::Internal,
        }
    }
}

impl fmt::Display for ActingEntity<'_> {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Bot(bot_id) => bot_id.fmt(formatter),
            Self::Harness(harness_id) => harness_id.fmt(formatter),
            Self::User(user_id) => formatter.write_str(user_id.as_ref()),
            Self::Internal => formatter.write_str("internal"),
        }
    }
}

/// Rejection returned when request credentials cannot authorize a user.
#[derive(Clone, Debug)]
pub struct MacroAuthorizationRejection {
    /// HTTP status returned to the client.
    pub status: StatusCode,
    /// Client-safe error message returned in the response body.
    pub message: Cow<'static, str>,
}

impl fmt::Display for MacroAuthorizationRejection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for MacroAuthorizationRejection {}

impl IntoResponse for MacroAuthorizationRejection {
    fn into_response(self) -> Response {
        let Self { status, message } = self;
        (status, Json(ErrorResponse { message })).into_response()
    }
}

/// Axum state containing the service used by authorization extractors.
pub struct MacroAuthorizationState<Svc> {
    pub(super) service: Arc<Svc>,
}

impl<Svc> MacroAuthorizationState<Svc> {
    /// Create authorization state backed by the supplied service.
    pub fn new(service: Arc<Svc>) -> Self {
        Self { service }
    }
}

impl<Svc> Clone for MacroAuthorizationState<Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
        }
    }
}

pub(super) fn authenticated_user(
    user_context: UserContext,
) -> Result<MacroUserAuthentication, MacroAuthorizationRejection> {
    let macro_user_id = MacroUserIdStr::parse_from_str(&user_context.user_id)
        .map(CowLike::into_owned)
        .map_err(|error| {
            tracing::error!(error=?error, "authorized context contained invalid macro user id");
            rejection("invalid user id")
        })?;

    Ok(MacroUserAuthentication {
        macro_user_id,
        user_context,
    })
}

pub(super) fn rejection(message: &'static str) -> MacroAuthorizationRejection {
    status_rejection(StatusCode::UNAUTHORIZED, message)
}

pub(super) fn status_rejection(
    status: StatusCode,
    message: &'static str,
) -> MacroAuthorizationRejection {
    MacroAuthorizationRejection {
        status,
        message: message.into(),
    }
}
