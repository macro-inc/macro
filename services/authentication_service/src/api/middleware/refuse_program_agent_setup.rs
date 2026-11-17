//! Keep agents' programs from finishing an agent account's setup.

use crate::api::context::AuthorizationService;
use axum::{
    Json,
    extract::{FromRequestParts, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_authorization::{
    AnyPrincipal, MacroAuthorization, MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
    is_program_run,
};
use model::response::ErrorResponse;

#[cfg(test)]
mod test;

/// Why a program may not finish an agent's setup.
const PROGRAM_SETUP_REFUSAL: &str = "An agent's program cannot finish an agent account's setup: it returns the account's lasting API key. Its operator finishes setup in the browser, signed in as the agent.";

/// Refuse setup to a program. Setup returns the agent account's API key,
/// which never expires, and replaces the one it had, so only its operator
/// finishes it, in the browser: never a program (a credential signed for an
/// agent or a routine run, or the code-mode header) nor a bot. A credential
/// that does not verify is rejected here, so a failed check cannot let the
/// request through.
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
        Some(MacroAuthorization::User(user)) => is_program_run(user.attribution(), &parts.headers),
        Some(MacroAuthorization::Bot(_)) => true,
        _ => parts
            .headers
            .contains_key(macro_authorization::CODE_EXECUTION_HEADER),
    };
    if program {
        tracing::warn!("refused an agent's setup to a program");
        return (
            StatusCode::FORBIDDEN,
            Json(ErrorResponse {
                message: PROGRAM_SETUP_REFUSAL.into(),
            }),
        )
            .into_response();
    }
    next.run(Request::from_parts(parts, body)).await
}
