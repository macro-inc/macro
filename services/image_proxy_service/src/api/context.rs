use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use macro_env::Environment;

pub type AuthorizationService = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub logo_service: crate::domain::LogoService<crate::outbound::FaviconProvider>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub environment: Environment,
    pub http_client: reqwest::Client,
    /// Verifies the signed scope of an agent run's credential.
    pub jwt_validation_args: JwtValidationArgs,
}
