//! The one-click unsubscribe link every step carries: `GET` shows a confirm
//! page and never changes anything (link scanners only fetch), `POST` (the
//! page's button, or a mail client's RFC 8058 one-click) unsubscribes.

use std::sync::Arc;

use axum::{
    Router,
    extract::{Path, State},
    http::{HeaderValue, StatusCode, header},
    response::{Html, IntoResponse, Response},
    routing::get,
};

use crate::domain::ports::SequencesApi;

/// The route, relative to the service root; not in the OpenAPI document.
pub const UNSUBSCRIBE_PATH: &str = "/public/sequences/unsubscribe/{token}";

const CONFIRM_PAGE: &str = include_str!("public_unsubscribe/confirm.html");
const DONE_PAGE: &str = include_str!("public_unsubscribe/done.html");
const INVALID_PAGE: &str = include_str!("public_unsubscribe/invalid.html");

/// Build the public router.
pub fn unsubscribe_router<Api, T>(service: Arc<Api>) -> Router<T>
where
    Api: SequencesApi,
    T: Send + Sync + 'static,
{
    Router::new()
        .route(UNSUBSCRIBE_PATH, get(confirm).post(unsubscribe::<Api>))
        .with_state(service)
}

fn page(status: StatusCode, body: &'static str) -> Response {
    let mut response = (status, Html(body)).into_response();
    let headers = response.headers_mut();
    for (name, value) in [
        (header::CACHE_CONTROL, "no-store"),
        (header::REFERRER_POLICY, "no-referrer"),
        (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
        (
            header::CONTENT_SECURITY_POLICY,
            "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
        ),
    ] {
        headers.insert(name, HeaderValue::from_static(value));
    }
    headers.insert("x-robots-tag", HeaderValue::from_static("noindex"));
    response
}

async fn confirm() -> Response {
    page(StatusCode::OK, CONFIRM_PAGE)
}

async fn unsubscribe<Api: SequencesApi>(
    State(service): State<Arc<Api>>,
    Path(token): Path<String>,
) -> Response {
    match service.unsubscribe(&token).await {
        Ok(true) => page(StatusCode::OK, DONE_PAGE),
        Ok(false) => page(StatusCode::NOT_FOUND, INVALID_PAGE),
        Err(error) => {
            tracing::error!(error = ?error, "unsubscribe failed");
            page(StatusCode::INTERNAL_SERVER_ERROR, INVALID_PAGE)
        }
    }
}

#[cfg(test)]
mod test;
