use crate::config::Config;
use axum::extract::FromRef;
use macro_auth::InternalApiKey;
use macro_authorization::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use sqlx::PgPool;
use std::sync::Arc;

pub(crate) type AuthorizationService = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub db: PgPool,
    pub sns_client: Arc<sns_client::SNS>,
    pub config: Arc<Config>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
    pub internal_api_key: InternalApiKey,
}
