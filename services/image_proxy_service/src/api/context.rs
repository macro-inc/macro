use axum::extract::FromRef;
use macro_authorization::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use macro_env::Environment;

pub type AuthorizationService = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub environment: Environment,
    pub http_client: reqwest::Client,
}
