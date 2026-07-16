//! Extractor that gates a route to authenticated internal service-to-service
//! callers.

#[cfg(test)]
mod test;

use axum::{
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use entity_access::inbound::axum_extractors::InternalUser;

/// Rejection returned when a request is not an authenticated internal call.
#[derive(Debug, thiserror::Error)]
pub enum InternalAccessRejection {
    #[error("route is restricted to internal service-to-service calls")]
    NotInternal,
}

impl IntoResponse for InternalAccessRejection {
    fn into_response(self) -> Response {
        (StatusCode::UNAUTHORIZED, self.to_string()).into_response()
    }
}

/// Asserts that the request is an authenticated internal call.
///
/// The internal-access middleware inserts an [`InternalUser`] into the request
/// extensions once it validates the internal auth header.
#[derive(Debug)]
pub struct InternalAccessExtractor;

impl<S> FromRequestParts<S> for InternalAccessExtractor
where
    S: Send + Sync,
{
    type Rejection = InternalAccessRejection;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<InternalUser>()
            .map(|_| Self)
            .ok_or(InternalAccessRejection::NotInternal)
    }
}
