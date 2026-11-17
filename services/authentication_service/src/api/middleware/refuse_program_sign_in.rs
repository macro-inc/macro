//! Keep agents' programs out of the email sign-in flow.

use crate::api::context::AuthorizationService;
use axum::{
    extract::{FromRequestParts, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_authorization::{
    AnyPrincipal, CODE_EXECUTION_HEADER, MacroAuthorization, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor, is_program_run,
};

#[cfg(test)]
mod test;

/// Why a program may not start or finish an email sign-in.
const PROGRAM_SIGN_IN_REFUSAL: &str = "An agent's program cannot sign in to Macro: the sign-in code would give it the account. Tell the user to sign in themselves.";

/// Refuse the email sign-in to a program: a program that starts one and
/// reads the code from the user's inbox holds the user's session.
///
/// These routes take no credential, so a program shows by the code-mode
/// runtime's header, or by a credential it sends that is signed for an agent
/// or a routine run (`is_program_run`). A credential that does not verify
/// counts as none, so a person with a stale session still signs in.
pub(in crate::api) async fn handler(
    State(authorization): State<MacroAuthorizationState<AuthorizationService>>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    let program = parts.headers.contains_key(CODE_EXECUTION_HEADER)
        || matches!(
            OptionalMacroAuthorizationExtractor::<AuthorizationService, AnyPrincipal>::from_request_parts(
                &mut parts,
                &authorization,
            )
            .await,
            Ok(OptionalMacroAuthorizationExtractor {
                authorization: Some(MacroAuthorization::User(ref user)),
                ..
            }) if is_program_run(user.attribution(), &parts.headers)
        );
    if program {
        tracing::warn!("refused an email sign-in to a program");
        return (StatusCode::FORBIDDEN, PROGRAM_SIGN_IN_REFUSAL).into_response();
    }
    next.run(Request::from_parts(parts, body)).await
}
