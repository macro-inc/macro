use axum::{
    body::Body,
    extract::Request,
    http::{Method, Response, StatusCode},
    middleware::Next,
};
use tracing::Instrument;

#[cfg(feature = "cloud_storage")]
pub mod cloud_storage;

#[cfg(feature = "tracking")]
pub mod tracking;

#[cfg(feature = "cloud_storage")]
mod error_handler;

/// Wraps all POST/PUT/PATCH/DELETE requests in a tokio task to prevent failure in the event the
/// connection is terminated
pub async fn connection_drop_prevention_handler(req: Request, next: Next) -> Response<Body> {
    match req.method() {
        &Method::PUT | &Method::POST | &Method::PATCH | &Method::DELETE => {
            let span = tracing::Span::current();
            let handle = tokio::task::spawn(next.run(req).instrument(span));
            
            match handle.await {
                Ok(response) => response,
                Err(err) => {
                    if err.is_panic() {
                        tracing::error!(error=?err, "request handler panicked");
                    } else {
                        tracing::error!(error=?err, "request handler task was cancelled");
                    }
                    Response::builder()
                        .status(StatusCode::INTERNAL_SERVER_ERROR)
                        .body(Body::empty())
                        .unwrap()
                }
            }
        }
        _ => next.run(req).await,
    }
}
