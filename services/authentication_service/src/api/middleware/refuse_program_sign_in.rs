//! Keep agents' programs out of the email sign-in flow.

use crate::api::context::AuthorizationService;
use axum::{
    extract::{FromRequestParts, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use macro_authorization::{
    AnyPrincipal, CredentialAttribution, MacroAuthorization, MacroAuthorizationState,
    OptionalMacroAuthorizationExtractor, PROGRAM_SIGN_IN_REFUSAL, is_program_run,
};

#[cfg(test)]
mod test;

/// Refuse the email sign-in to a program: one that starts it and reads the
/// code from the user's inbox would hold the user's session.
///
/// These routes take no credential. Inside the code-mode sandbox every
/// request carries `x-macro-code-execution`, which is the guard; a sent
/// credential signed for an agent or routine run refuses too, though a
/// program outside the sandbox can simply send none. A credential that does
/// not verify counts as none, so a person with a stale session still signs in.
pub(in crate::api) async fn handler(
    State(authorization): State<MacroAuthorizationState<AuthorizationService>>,
    request: Request,
    next: Next,
) -> Response {
    let (mut parts, body) = request.into_parts();
    let attribution = match OptionalMacroAuthorizationExtractor::<
        AuthorizationService,
        AnyPrincipal,
    >::from_request_parts(&mut parts, &authorization)
    .await
    {
        Ok(OptionalMacroAuthorizationExtractor {
            authorization: Some(MacroAuthorization::User(user)),
            ..
        }) => user.attribution(),
        _ => CredentialAttribution::Person,
    };
    if is_program_run(attribution, &parts.headers) {
        // The route template, never the path: the callback's path is the code.
        let route = parts
            .extensions
            .get::<axum::extract::MatchedPath>()
            .map_or("unmatched", axum::extract::MatchedPath::as_str);
        tracing::warn!(route, ?attribution, "refused an email sign-in to a program");
        return (StatusCode::FORBIDDEN, PROGRAM_SIGN_IN_REFUSAL).into_response();
    }
    next.run(Request::from_parts(parts, body)).await
}
