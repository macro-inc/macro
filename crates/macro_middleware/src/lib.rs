use axum::{
    body::Body,
    extract::Request,
    http::{Method, Response},
    middleware::Next,
};

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
            tokio::task::spawn(next.run(req)).await.unwrap()
        }
        _ => next.run(req).await,
    }
}
