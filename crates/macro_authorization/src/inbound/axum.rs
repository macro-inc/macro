#[cfg(test)]
mod test;

mod bot;
mod internal;
mod macro_authorization;
mod optional;
mod user;

use std::{borrow::Cow, fmt, sync::Arc};

use ::axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_error_response::ErrorResponse;
use model_user::UserContext;

use crate::MacroUserAuthentication;

pub use bot::{
    BOT_FOR_FUSIONAUTH_USER_ID_HEADER, BOT_FOR_MACRO_USER_ID_HEADER,
    BOT_FOR_ORGANIZATION_ID_HEADER, BOT_TOKEN_HEADER, BotMacroAuthorizationExtractor,
};
#[allow(deprecated)]
pub use internal::{
    INTERNAL_API_KEY_HEADER, INTERNAL_FUSIONAUTH_USER_ID_HEADER,
    INTERNAL_MACRO_ORGANIZATION_ID_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
    InternalMacroAuthorizationExtractor, LEGACY_DSS_INTERNAL_API_KEY_HEADER,
    LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER,
};
pub use macro_authorization::MacroAuthorizationExtractor;
pub use optional::OptionalMacroAuthorizationExtractor;
pub use user::UserMacroAuthorizationExtractor;

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
