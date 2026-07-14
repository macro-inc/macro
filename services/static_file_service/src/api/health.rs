use axum::{Router, routing::get};

async fn health_handler() -> String {
    "healthy".to_string()
}

pub fn router<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
{
    Router::new().route("/health", get(health_handler))
}
