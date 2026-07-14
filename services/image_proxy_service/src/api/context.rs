use axum::extract::FromRef;
use macro_authorization::SharedMacroAuthorizationService;
use macro_env::Environment;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub authorization: SharedMacroAuthorizationService,
    pub environment: Environment,
    pub http_client: reqwest::Client,
}
