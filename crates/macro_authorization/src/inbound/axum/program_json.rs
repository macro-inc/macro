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
/// runtime's header, or a JWT signed for an agent or a routine run. Only a
/// Macro API JWT can carry those claims, so a request carrying no JWT (a
/// cookie, a bearer, or the `macro-api-token` query) is a person's without a
/// second credential lookup. A JWT that does not verify counts as none; the
/// route rejects it.
pub async fn request_is_program<Svc: MacroAuthorizationService>(
    request: Request,
    authorization: &MacroAuthorizationState<Svc>,
) -> (Request, bool) {
    if request.headers().contains_key(super::CODE_EXECUTION_HEADER) {
        return (request, true);
    }
    let may_carry_claims = request.headers().contains_key(header::AUTHORIZATION)
        || request.headers().contains_key(header::COOKIE)
        || request
            .uri()
            .query()
            .is_some_and(|query| query.contains("macro-api-token="));
    if !may_carry_claims {
        return (request, false);
    }
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

/// `application/json` or a structured `application/*+json` type.
fn is_json(content_type: &str) -> bool {
    let media = content_type.split(';').next().unwrap_or_default().trim();
    media.eq_ignore_ascii_case("application/json")
        || (media.starts_with("application/") && media.ends_with("+json"))
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
        .is_some_and(is_json);
    if !program || !json {
        return response;
    }
    let (mut parts, body) = response.into_parts();
    // The rewritten body has its own length and validator.
    parts.headers.remove(header::CONTENT_LENGTH);
    parts.headers.remove(header::ETAG);
    let Ok(bytes) = ::axum::body::to_bytes(body, usize::MAX).await else {
        tracing::warn!("could not read a response to rewrite for a program");
        parts.status = ::axum::http::StatusCode::INTERNAL_SERVER_ERROR;
        return Response::from_parts(parts, Body::empty());
    };
    let Ok(mut value) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        return Response::from_parts(parts, Body::from(bytes));
    };
    rewrite(&mut value);
    Response::from_parts(parts, Body::from(value.to_string()))
}
