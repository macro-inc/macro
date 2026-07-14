use axum::extract::FromRef;
use macro_authorization::MacroAuthorizationServiceHandle;
use macro_env::Environment;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub authorization: MacroAuthorizationServiceHandle,
    pub environment: Environment,
    pub http_client: reqwest::Client,
}
