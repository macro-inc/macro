use axum::extract::FromRef;
use macro_env::Environment;

use crate::http_safety::SsrfSafeHttpClient;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub environment: Environment,
    pub http_client: SsrfSafeHttpClient,
}
