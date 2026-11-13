use std::sync::Arc;

use axum::Router;
use axum::extract::DefaultBodyLimit;
use axum::routing::get;

use crate::domain::ports::{IndexStore, ObjectStore};
use crate::domain::service::GitaiService;

#[cfg(test)]
mod test;

/// Largest request body a `/worker` route accepts. A batch of 1,000 transcript
/// events averages about 5 MB and can be far larger; axum's default is 2 MB.
pub const WORKER_BODY_LIMIT_BYTES: usize = 64 * 1024 * 1024;

/// The service's routes, without the gateway prefix: `GET /health`, the
/// client-facing `/worker/*` routes and the `/v1/*` read API.
pub fn router<Objects: ObjectStore, Index: IndexStore>(
    service: Arc<GitaiService<Objects, Index>>,
) -> Router {
    Router::new()
        .route("/health", get(health))
        .nest("/worker", worker_routes())
        .with_state(service)
}

/// `GET /health`: 200 while the process runs. It touches no storage, so an
/// S3 or DynamoDB outage does not take the task out of the gateway.
async fn health() -> &'static str {
    "healthy"
}

/// The routes the git-ai client calls. Add each route here, before the body
/// limit: a layer only wraps the routes that exist when it is applied.
fn worker_routes<State: Clone + Send + Sync + 'static>() -> Router<State> {
    with_worker_body_limit(Router::new())
}

fn with_worker_body_limit<State: Clone + Send + Sync + 'static>(
    routes: Router<State>,
) -> Router<State> {
    routes.layer(DefaultBodyLimit::max(WORKER_BODY_LIMIT_BYTES))
}
