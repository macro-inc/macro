//! Defines axum integrations for the RateLimitService
use std::marker::PhantomData;

use crate::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitService, domain::models::RateLimitOk,
};
use axum::{
    RequestPartsExt,
    extract::{FromRef, FromRequestParts, Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::either::Either3;

/// trait which allows a caller to define rate limit key via the hash impl and a config
pub trait RateLimitExtractable<S>: FromRequestParts<S> + Send + 'static {
    /// return the configuration for this rate limit that the key will be compared against
    fn config() -> RateLimitConfig;
    /// the return the rate limit key for this value
    fn key(&self) -> RateLimitKey;
}

/// An extractor for some rate limit key, where K: Hash + FromRequestParts
pub struct RateLimitExtractor<K, Svc> {
    key_phantom: PhantomData<K>,
    service_phantom: PhantomData<Svc>,
    /// the [RateLimitOk] value which is returned, guaranteeing the rate limit is valid
    pub rate_limit_success: RateLimitOk,
}

impl IntoResponse for RateLimitExceeded {
    fn into_response(self) -> axum::response::Response {
        StatusCode::TOO_MANY_REQUESTS.into_response()
    }
}

type RateLimitErr<Rej> = Either3<Rej, RateLimitExceeded, StatusCode>;

impl<K, S, Svc> FromRequestParts<S> for RateLimitExtractor<K, Svc>
where
    K: RateLimitExtractable<S>,
    S: Send + Sync,
    Svc: FromRef<S>,
    Svc: RateLimitService,
{
    type Rejection = RateLimitErr<K::Rejection>;

    async fn from_request_parts(
        parts: &mut axum::http::request::Parts,
        state: &S,
    ) -> Result<Self, Self::Rejection> {
        let service: Svc = FromRef::from_ref(state);
        let key: K = parts.extract_with_state(state).await.map_err(Either3::E1)?;
        let rate_limit_key = key.key();
        let config = K::config();
        let res = service
            .check_rate_limit(rate_limit_key, config)
            .await
            .inspect_err(|e| tracing::error!(error=?e, "rate limit check failed"))
            .map_err(|_| Either3::E3(StatusCode::INTERNAL_SERVER_ERROR))?;
        match res {
            Ok(ok) => Ok(RateLimitExtractor {
                key_phantom: PhantomData,
                service_phantom: PhantomData,
                rate_limit_success: ok,
            }),
            Err(exceeded) => Err(Either3::E2(exceeded)),
        }
    }
}

/// Rate limit middleware which leverages [RateLimitExtractor] to check and asser the limit  before the inner handler runs.
/// If the response status code from the handler is 2xx, then the counter will be incremented for the rate limit.
pub async fn rate_limit_middleware<S, K, Svc>(
    extractable: RateLimitExtractor<K, Svc>,
    State(service): State<Svc>,
    req: Request,
    next: Next,
) -> Response
where
    K: RateLimitExtractable<S>,
    S: Send + Sync,
    Svc: FromRef<S>,
    Svc: RateLimitService,
{
    let response = next.run(req).await;
    if !response.status().is_success() {
        let _ = service
            .rollback_ticket(extractable.rate_limit_success)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "Failed to rollback rate limit counter in middleware")
            });
    }
    response
}
