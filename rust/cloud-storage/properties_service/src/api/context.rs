use axum::extract::FromRef;
use comms_service_client::CommsServiceClient;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use properties_service::{
    domain::services::PropertyServiceImpl,
    outbound::{PgPermissionChecker, PropertiesPgStorage},
};
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

use crate::config::Config;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    /// Macrodb database connection (contains properties tables and permission tables)
    pub db: PgPool,
    pub jwt_args: JwtValidationArgs,
    pub config: Arc<Config>,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub comms_service_client: Arc<CommsServiceClient>,
    /// Unified property service (handles definitions, options, and entity properties)
    pub property_service: Arc<PropertyServiceImpl<PropertiesPgStorage, PgPermissionChecker>>,
}
