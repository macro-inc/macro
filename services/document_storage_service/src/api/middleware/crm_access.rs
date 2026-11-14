//! Fresh CRM authority for retiring caches in an already-open client session.

use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    extract::{Request, State},
    http::HeaderValue,
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::Cached;
use crm::domain::{model::CrmError, service::CrmService};
use macro_authorization::{AnyPrincipal, MacroAuthorization, OptionalMacroAuthorizationExtractor};

pub(crate) const HEADER: &str = "x-macro-crm-access";

#[tracing::instrument(skip_all)]
pub(crate) async fn handler(
    State(state): State<ApiContext>,
    Cached(auth): Cached<OptionalMacroAuthorizationExtractor<AuthorizationService, AnyPrincipal>>,
    request: Request,
    next: Next,
) -> Response {
    let authority = if let Some(user) = auth
        .authorization
        .as_ref()
        .and_then(MacroAuthorization::acting_user)
    {
        Some(
            state
                .crm_state
                .service
                .current_member_access(user.macro_user_id.as_ref())
                .await
                .map(|access| {
                    match access {
                        Some((team, allowed)) => {
                            format!("{team}:{}", if allowed { "allowed" } else { "denied" })
                        }
                        None => "none".to_owned(),
                    }
                    .parse()
                    .expect("CRM authority is a valid header")
                }),
        )
    } else {
        None
    };
    respond(request, next, authority).await
}

async fn respond(
    request: Request,
    next: Next,
    authority: Option<Result<HeaderValue, CrmError>>,
) -> Response {
    // Each protected handler authorizes itself. This optional freshness signal
    // must not turn a CRM lookup failure into an unrelated operation failure.
    let mut response = next.run(request).await.into_response();
    match authority {
        Some(Ok(value)) => {
            response.headers_mut().insert(HEADER, value);
        }
        Some(Err(error)) => tracing::warn!(error = ?error, "unable to publish CRM authority"),
        None => {}
    }
    response
}

#[cfg(test)]
mod test {
    use super::*;
    use axum::{Router, body::Body, http::StatusCode, middleware, routing::get};
    use tower::ServiceExt;

    #[tokio::test]
    async fn unavailable_authority_does_not_block_an_unrelated_handler() {
        let app = Router::new()
            .route("/document", get(|| async { StatusCode::ACCEPTED }))
            .layer(middleware::from_fn(|request, next| async move {
                respond(
                    request,
                    next,
                    Some(Err(CrmError::StorageLayerError(anyhow::anyhow!(
                        "unavailable"
                    )))),
                )
                .await
            }));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/document")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        assert!(!response.headers().contains_key(HEADER));
    }

    #[tokio::test]
    async fn authority_header_does_not_override_a_protected_handlers_denial() {
        let app = Router::new()
            .route("/crm", get(|| async { StatusCode::FORBIDDEN }))
            .layer(middleware::from_fn(|request, next| async move {
                respond(request, next, Some(Ok(HeaderValue::from_static("none")))).await
            }));
        let response = app
            .oneshot(Request::builder().uri("/crm").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(response.headers()[HEADER], "none");
    }
}
