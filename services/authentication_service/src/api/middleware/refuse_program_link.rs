//! Keep agents' programs from starting an account link.

use crate::api::context::AuthorizationService;
use axum::{
    Json,
    extract::{FromRequestParts, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_authorization::{
    AnyPrincipal, CredentialOrigin, MacroAuthorization, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor, is_program_run,
};
use model::response::ErrorResponse;

#[cfg(test)]
mod test;

/// Why a program may not start a Google or GitHub link.
const PROGRAM_LINK_REFUSAL: &str = "An agent's program cannot link an account: the link would let whoever opens it sign in as the user. Tell the user to link the account themselves in Settings.";

/// Refuse a link start to a program. The consent URL it returns works in any
/// browser, so a program could hand it to someone else, whose Google or
/// GitHub identity would then sign in to this account.
///
/// A program is a credential signed for an agent or a routine run, or the
/// code-mode header (`is_program_run`); a bot acting for the user, an
/// account manager's key and a scoped session are refused too. A credential that does not verify is rejected here, so a check that
/// fails cannot let the request through.
pub(in crate::api) async fn handler(
    State(authorization): State<MacroAuthorizationState<AuthorizationService>>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    let principal = match OptionalMacroAuthorizationExtractor::<AuthorizationService, AnyPrincipal>::from_request_parts(
        &mut parts,
        &authorization,
    )
    .await
    {
        Ok(extractor) => extractor.authorization,
        Err(rejection) => return rejection.into_response(),
    };
    let program = match &principal {
        // An account manager's key and a scoped session act for this
        // account but are not its holder; neither may add a sign-in to it.
        Some(MacroAuthorization::User(user)) => {
            matches!(
                user.origin,
                CredentialOrigin::AccountManager(_) | CredentialOrigin::ScopedMacroApiJwt
            ) || is_program_run(user.attribution(), &parts.headers)
        }
        Some(MacroAuthorization::Bot(_)) => true,
        _ => parts
            .headers
            .contains_key(macro_authorization::CODE_EXECUTION_HEADER),
    };
    if program {
        tracing::warn!(
            route = parts.uri.path(),
            "refused an account link to a program"
        );
        return (
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                message: PROGRAM_LINK_REFUSAL.into(),
            }),
        )
            .into_response();
    }
    next.run(Request::from_parts(parts, body)).await
}
