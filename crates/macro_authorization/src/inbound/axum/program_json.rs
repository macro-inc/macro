//! Rewrite what a program reads from a route, leaving people's responses alone.

use ::axum::{
    body::Body,
    extract::{FromRequestParts, Request},
    http::header,
    middleware::Next,
    response::Response,
};

use super::{AnyPrincipal, MacroAuthorizationState, OptionalMacroAuthorizationExtractor};
use crate::{
    MacroAuthorization, MacroAuthorizationService, domain::models::CredentialAttribution,
    is_program_run,
};

/// Whether a request is a program's ([`is_program_run`]): the code-mode
/// runtime's header, or a credential signed for an agent or a routine run.
/// A credential that does not verify counts as none; the route rejects it.
pub async fn request_is_program<Svc: MacroAuthorizationService>(
    request: Request,
    authorization: &MacroAuthorizationState<Svc>,
) -> (Request, bool) {
    let (mut parts, body) = request.into_parts();
    let attribution =
        match OptionalMacroAuthorizationExtractor::<Svc, AnyPrincipal>::from_request_parts(
            &mut parts,
            authorization,
        )
        .await
        {
            Ok(OptionalMacroAuthorizationExtractor {
                authorization: Some(MacroAuthorization::User(user)),
                ..
            }) => user.attribution(),
            _ => CredentialAttribution::Person,
        };
    let program = is_program_run(attribution, &parts.headers);
    (Request::from_parts(parts, body), program)
}

/// Middleware body: for a program's request, run `rewrite` over a JSON
/// response before the program reads it. Other responses, and every
/// response to a person, pass through unchanged.
pub async fn rewrite_program_json<Svc: MacroAuthorizationService>(
    authorization: MacroAuthorizationState<Svc>,
    request: Request,
    next: Next,
    rewrite: fn(&mut serde_json::Value),
) -> Response {
    let (request, program) = request_is_program(request, &authorization).await;
    let response = next.run(request).await;
    let json = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"));
    if !program || !json {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    let Ok(bytes) = ::axum::body::to_bytes(body, usize::MAX).await else {
        tracing::warn!("could not read a response to rewrite for a program");
        return Response::from_parts(parts, Body::empty());
    };
    let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Response::from_parts(parts, Body::from(bytes));
    };
    rewrite(&mut value);
    parts.headers.remove(header::CONTENT_LENGTH);
    Response::from_parts(parts, Body::from(value.to_string()))
}
