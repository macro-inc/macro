//! Rewrite what a program reads from a route, leaving people's responses alone.

use ::axum::{body::Body, extract::Request, http::header, middleware::Next, response::Response};

use super::MacroAuthorizationState;

#[cfg(test)]
mod test;
use crate::MacroAuthorizationService;
#[cfg(doc)]
use crate::is_program_run;

/// Whether a request is a program's ([`is_program_run`]): the code-mode
/// runtime's header, or a Macro API JWT signed for an agent or a routine
/// run.
///
/// Only a Macro API JWT carries those signed claims, so this reads the
/// request's credential once, through the cached
/// [`macro_auth::credential::request_credential`] the route's own
/// authentication uses, and checks the signature of the user token it
/// authenticates with: no database lookup and no second credential
/// extraction. A user API key, bot, harness or internal credential carries
/// no program claims. A JWT that does not verify counts as none; the route
/// rejects it.
pub async fn request_is_program<Svc: MacroAuthorizationService>(
    request: Request,
    authorization: &MacroAuthorizationState<Svc>,
) -> (Request, bool) {
    if request.headers().contains_key(super::CODE_EXECUTION_HEADER) {
        return (request, true);
    }
    let (mut parts, body) = request.into_parts();
    let token = match macro_auth::credential::request_credential(&mut parts) {
        Ok(macro_auth::credential::RequestCredential {
            kind: macro_auth::credential::CredentialKind::UserToken { token, .. },
            ..
        }) => Some(token),
        _ => None,
    };
    let program = match token {
        Some(token) => authorization
            .service
            .authorize_identity(&token)
            .await
            .is_ok_and(|credential| {
                credential.identity.agent_id.is_some() || credential.identity.routine_id.is_some()
            }),
        None => false,
    };
    (Request::from_parts(parts, body), program)
}

/// `application/json` or a structured `application/*+json` type.
fn is_json(content_type: &str) -> bool {
    let media = content_type.split(';').next().unwrap_or_default().trim();
    let media = media.to_ascii_lowercase();
    media == "application/json" || (media.starts_with("application/") && media.ends_with("+json"))
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
