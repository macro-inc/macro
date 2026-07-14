use axum::extract::FromRef;
use macro_authorization::MacroAuthorizationServiceImpl;
use macro_env::Environment;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub authorization: MacroAuthorizationServiceImpl,
    pub environment: Environment,
    pub http_client: reqwest::Client,
}
