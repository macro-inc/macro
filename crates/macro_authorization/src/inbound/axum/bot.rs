use ::axum::{
    extract::FromRef,
    http::{HeaderMap, StatusCode, request::Parts},
};
use rootcause::Report;

use crate::{
    BotActingUserClaims, BotAuthentication, BotScope, MacroAuthorizationError,
    MacroAuthorizationService,
};

use super::{MacroAuthorizationRejection, MacroAuthorizationState, rejection, status_rejection};

/// Header carrying a bot authentication token.
pub const BOT_TOKEN_HEADER: &str = "x-macro-bot-token";
/// Header carrying the access scope for a bot-authorized request.
pub const BOT_SCOPE_HEADER: &str = "x-macro-bot-scope";
/// Header carrying the Macro user ID a bot claims to act for.
pub const BOT_FOR_MACRO_USER_ID_HEADER: &str = "x-macro-bot-for-macro-user-id";
/// Header carrying the FusionAuth user ID a bot claims to act for.
pub const BOT_FOR_FUSIONAUTH_USER_ID_HEADER: &str = "x-macro-bot-for-fusionauth-user-id";
/// Header carrying the organization ID a bot claims to act for.
pub const BOT_FOR_ORGANIZATION_ID_HEADER: &str = "x-macro-bot-for-organization-id";

pub(super) async fn authorize_optional_bot_request<S, Svc>(
    parts: &Parts,
    state: &S,
) -> Result<Option<BotAuthentication>, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
{
    let Some(token) = bot_token(&parts.headers)? else {
        return Ok(None);
    };
    let bot_scope = bot_scope(&parts.headers)?;
    let claims = bot_acting_user_claims(&parts.headers)?;
    let authorization = MacroAuthorizationState::<Svc>::from_ref(state);
    let bot = authorization
        .service
        .authorize_bot(&token, bot_scope, claims)
        .await
        .map_err(bot_authorization_rejection)?;

    Ok(Some(bot))
}

fn bot_token(headers: &HeaderMap) -> Result<Option<String>, MacroAuthorizationRejection> {
    let Some(header) = headers.get(BOT_TOKEN_HEADER) else {
        return Ok(None);
    };
    let token = header.to_str().map_err(|_| rejection("unauthorized"))?;
    if token.trim().is_empty() {
        return Err(rejection("unauthorized"));
    }

    Ok(Some(token.to_owned()))
}

fn bot_scope(headers: &HeaderMap) -> Result<BotScope, MacroAuthorizationRejection> {
    let scope = headers
        .get(BOT_SCOPE_HEADER)
        .ok_or_else(invalid_bot_scope_rejection)?
        .to_str()
        .map_err(|_| invalid_bot_scope_rejection())?;

    match scope {
        "user" => Ok(BotScope::User),
        "team" => Ok(BotScope::Team),
        _ => Err(invalid_bot_scope_rejection()),
    }
}

fn bot_acting_user_claims(
    headers: &HeaderMap,
) -> Result<Option<BotActingUserClaims>, MacroAuthorizationRejection> {
    let user_id = bot_claim_header(headers, BOT_FOR_MACRO_USER_ID_HEADER)?;
    let fusion_user_id = bot_claim_header(headers, BOT_FOR_FUSIONAUTH_USER_ID_HEADER)?;
    let organization_id = bot_claim_header(headers, BOT_FOR_ORGANIZATION_ID_HEADER)?
        .map(|organization_id| organization_id.parse::<i32>())
        .transpose()
        .map_err(|_| invalid_bot_claims_rejection())?;

    if user_id.is_none() && fusion_user_id.is_none() && organization_id.is_none() {
        return Ok(None);
    }

    Ok(Some(BotActingUserClaims {
        user_id,
        fusion_user_id,
        organization_id,
    }))
}

fn bot_claim_header(
    headers: &HeaderMap,
    name: &'static str,
) -> Result<Option<String>, MacroAuthorizationRejection> {
    headers
        .get(name)
        .map(|header| {
            header
                .to_str()
                .map(str::to_owned)
                .map_err(|_| invalid_bot_claims_rejection())
        })
        .transpose()
}

fn invalid_bot_scope_rejection() -> MacroAuthorizationRejection {
    status_rejection(StatusCode::BAD_REQUEST, "invalid bot scope")
}

fn invalid_bot_claims_rejection() -> MacroAuthorizationRejection {
    status_rejection(StatusCode::BAD_REQUEST, "invalid bot claims")
}

fn bot_authorization_rejection(
    error: Report<MacroAuthorizationError>,
) -> MacroAuthorizationRejection {
    let rejection = match error.current_context() {
        MacroAuthorizationError::CredentialsExpired
        | MacroAuthorizationError::InvalidCredentials => rejection("unauthorized"),
        MacroAuthorizationError::ActingUserNotAuthorized
        | MacroAuthorizationError::BotScopeNotAuthorized => {
            status_rejection(StatusCode::FORBIDDEN, "forbidden")
        }
        MacroAuthorizationError::Unavailable => {
            status_rejection(StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
        }
    };
    tracing::error!(error=?error, "bot authorization failed");
    rejection
}
