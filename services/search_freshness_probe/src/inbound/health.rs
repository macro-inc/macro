//! `GET /health`: 200 while the process runs, for compose and a local check.
//! Nothing else calls the probe.

use axum::Router;
use axum::routing::get;

/// The health router.
pub fn router() -> Router {
    Router::new().route("/health", get(|| async {}))
}
