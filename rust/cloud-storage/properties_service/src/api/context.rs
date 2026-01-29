use axum::extract::FromRef;
use comms_service_client::CommsServiceClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

use crate::config::Config;
use properties::PropertiesServiceImpl;

/// Type alias for the properties service implementation used throughout the service.
pub type PropertiesService = PropertiesServiceImpl<
    properties::PropertiesPgRepo,
    properties::PermissionServiceImpl,
    properties::NotificationServiceImpl,
>;

/// Minimal state required by properties handlers.
/// This can be extracted from any state that implements `FromRef<PropertiesHandlerState>`.
#[derive(Clone, FromRef)]
pub struct PropertiesHandlerState {
    /// Macrodb database connection (contains properties tables and permission tables)
    pub db: PgPool,
    /// The properties service implementation
    pub properties_service: Arc<PropertiesService>,
}

#[derive(Clone, FromRef)]
pub struct ApiContext {
    /// Macrodb database connection (contains properties tables and permission tables)
    pub db: PgPool,
    pub jwt_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub comms_service_client: Arc<CommsServiceClient>,
    pub properties_service: Arc<PropertiesService>,
}

impl From<&ApiContext> for PropertiesHandlerState {
    fn from(ctx: &ApiContext) -> Self {
        PropertiesHandlerState {
            db: ctx.db.clone(),
            properties_service: ctx.properties_service.clone(),
        }
    }
}

impl FromRef<ApiContext> for PropertiesHandlerState {
    fn from_ref(ctx: &ApiContext) -> Self {
        PropertiesHandlerState::from(ctx)
    }
}
