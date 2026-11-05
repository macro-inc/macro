//! The artifact content origin: `<document_id>.<artifact content host>`.
//!
//! Requests reach this router only through [`dispatch_by_host`], so pages on
//! an artifact origin never see the API and API hosts never serve pages.
//! URLs are `/t/<view token>/v/<number>/<path>`; the token sits in the path
//! so every relative URL in a page keeps working, and it is the only
//! credential: these hosts set and read no cookies.

#[cfg(test)]
mod test;

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use tower::ServiceExt;

use crate::domain::models::{ArtifactError, ContentOrigin, ContentRequest, ContentResponse};
use crate::domain::ports::ArtifactService;

/// Script and style CDNs a page may load from, as Claude artifacts allow.
const CONTENT_SECURITY_POLICY_SOURCES: &str = "default-src 'self'; \
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com; \
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; \
font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; \
img-src 'self' data: blob:; \
media-src 'self' data: blob:; \
connect-src 'self'; \
form-action 'none'; \
base-uri 'none'";

/// Versions never change, so a file under a version path never does either.
const IMMUTABLE: &str = "private, max-age=31536000, immutable";

/// The headers every content response carries.
#[derive(Clone)]
pub struct ContentHeaders {
    content_security_policy: HeaderValue,
}

impl ContentHeaders {
    /// Headers allowing only `frame_ancestors` (the Macro app origins) to
    /// embed artifacts.
    pub fn new(frame_ancestors: &[String]) -> Result<Self, axum::http::header::InvalidHeaderValue> {
        let policy = format!(
            "{CONTENT_SECURITY_POLICY_SOURCES}; frame-ancestors {}",
            frame_ancestors.join(" ")
        );
        Ok(Self {
            content_security_policy: HeaderValue::from_str(&policy)?,
        })
    }

    fn apply(&self, headers: &mut HeaderMap) {
        headers.insert(
            header::CONTENT_SECURITY_POLICY,
            self.content_security_policy.clone(),
        );
        headers.insert(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        );
        headers.insert(
            header::REFERRER_POLICY,
            HeaderValue::from_static("no-referrer"),
        );
        headers.insert(
            HeaderName::from_static("cross-origin-resource-policy"),
            HeaderValue::from_static("same-origin"),
        );
    }
}

/// State of the content router.
pub struct ContentRouterState<Service> {
    service: Arc<Service>,
    origin: ContentOrigin,
    headers: ContentHeaders,
}

impl<Service> Clone for ContentRouterState<Service> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            origin: self.origin.clone(),
            headers: self.headers.clone(),
        }
    }
}

impl<Service> ContentRouterState<Service> {
    /// Content router state.
    pub fn new(service: Arc<Service>, origin: ContentOrigin, headers: ContentHeaders) -> Self {
        Self {
            service,
            origin,
            headers,
        }
    }
}

/// The router every artifact origin request goes to.
pub fn content_router<Service>(state: ContentRouterState<Service>) -> Router
where
    Service: ArtifactService,
{
    Router::new()
        .fallback(any(serve::<Service>))
        .with_state(state)
        .layer(
            macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::from_secs(2))
                .into_inner(),
        )
}

/// Send requests for the artifact content host (and every artifact under it)
/// to `content`, and everything else to `api`.
pub fn dispatch_by_host(api: Router, content: Router, origin: ContentOrigin) -> Router {
    Router::new().fallback(move |request: Request| {
        let is_content = request
            .headers()
            .get(header::HOST)
            .and_then(|host| host.to_str().ok())
            .is_some_and(|host| origin.serves_host(host));
        let target = if is_content {
            content.clone()
        } else {
            api.clone()
        };
        async move {
            match target.oneshot(request).await {
                Ok(response) => response,
                Err(infallible) => match infallible {},
            }
        }
    })
}

fn refuse(headers: &ContentHeaders, status: StatusCode, message: &'static str) -> Response {
    let mut response = (status, message).into_response();
    headers.apply(response.headers_mut());
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// `/t/<token>/v/<number>/<path>` split into its parts. The path stays
/// percent-encoded.
fn split_path(path: &str) -> Option<(&str, &str, &str)> {
    let rest = path.strip_prefix("/t/")?;
    let (token, rest) = rest.split_once('/')?;
    let rest = rest.strip_prefix("v/")?;
    let (number, file) = match rest.split_once('/') {
        Some((number, file)) => (number, file),
        None => (rest, ""),
    };
    (!token.is_empty()).then_some((token, number, file))
}

async fn serve<Service>(
    State(state): State<ContentRouterState<Service>>,
    request: Request,
) -> Response
where
    Service: ArtifactService,
{
    let headers = &state.headers;

    if request.method() != Method::GET && request.method() != Method::HEAD {
        return refuse(
            headers,
            StatusCode::METHOD_NOT_ALLOWED,
            "method not allowed",
        );
    }

    // Artifacts render only inside Macro's frame, never as a top-level page
    // that could pose as Macro at its own URL.
    let is_navigation = request
        .headers()
        .get("sec-fetch-dest")
        .is_some_and(|dest| dest == "document");
    if is_navigation {
        return refuse(
            headers,
            StatusCode::FORBIDDEN,
            "artifacts open inside Macro",
        );
    }

    let Some(document_id) = request
        .headers()
        .get(header::HOST)
        .and_then(|host| host.to_str().ok())
        .and_then(|host| state.origin.document_id_from_host(host))
    else {
        return refuse(headers, StatusCode::NOT_FOUND, "not found");
    };

    let Some((token, number, file)) = split_path(request.uri().path()) else {
        return refuse(headers, StatusCode::NOT_FOUND, "not found");
    };
    let Ok(version) = number.parse::<i32>() else {
        return refuse(headers, StatusCode::NOT_FOUND, "not found");
    };
    let Ok(path) = urlencoding::decode(file) else {
        return refuse(headers, StatusCode::NOT_FOUND, "not found");
    };

    let cached_sha256 = request
        .headers()
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
        .map(|value| value.trim().trim_matches('"').to_string());

    let content = state
        .service
        .content(ContentRequest {
            host_document_id: document_id,
            token: token.to_string(),
            version,
            path: path.into_owned(),
            cached_sha256,
        })
        .await;

    match content {
        Ok(ContentResponse::File {
            content_type,
            size,
            sha256,
            body,
        }) => {
            let mut response = Response::new(Body::from_stream(body));
            let response_headers = response.headers_mut();
            headers.apply(response_headers);
            let content_type = HeaderValue::from_str(&content_type)
                .unwrap_or(HeaderValue::from_static("application/octet-stream"));
            response_headers.insert(header::CONTENT_TYPE, content_type);
            response_headers.insert(header::CONTENT_LENGTH, HeaderValue::from(size));
            response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(IMMUTABLE));
            if let Ok(etag) = HeaderValue::from_str(&format!("\"{}\"", sha256.as_str())) {
                response_headers.insert(header::ETAG, etag);
            }
            response
        }
        Ok(ContentResponse::NotModified { sha256 }) => {
            let mut response = StatusCode::NOT_MODIFIED.into_response();
            let response_headers = response.headers_mut();
            headers.apply(response_headers);
            response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(IMMUTABLE));
            if let Ok(etag) = HeaderValue::from_str(&format!("\"{}\"", sha256.as_str())) {
                response_headers.insert(header::ETAG, etag);
            }
            response
        }
        Err(ArtifactError::Forbidden(_)) => refuse(headers, StatusCode::FORBIDDEN, "forbidden"),
        Err(ArtifactError::NotFound(_) | ArtifactError::BadRequest(_)) => {
            refuse(headers, StatusCode::NOT_FOUND, "not found")
        }
        Err(ArtifactError::Conflict { .. }) => refuse(headers, StatusCode::NOT_FOUND, "not found"),
        Err(ArtifactError::Internal(error)) => {
            tracing::error!(error = ?error, "artifact content failed");
            refuse(headers, StatusCode::INTERNAL_SERVER_ERROR, "internal error")
        }
    }
}
