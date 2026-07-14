use axum::extract::FromRef;
use macro_env::Environment;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub environment: Environment,
    pub http_client: reqwest::Client,
}
