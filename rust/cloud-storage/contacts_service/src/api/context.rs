use crate::{api::ContactsService, config::Config};
use axum::extract::FromRef;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct AppState {
    pub config: Arc<Config>,
    pub db: PgPool,
    pub jwt_args: JwtValidationArgs,
    pub internal_api_secret: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub contacts_service: Arc<dyn ContactsService>,
}

impl AppState {
    #[cfg(test)]
    pub fn new_testing() -> Self {
        use sqlx::postgres::PgPoolOptions;

        use crate::api::MockService;

        let db = PgPoolOptions::new()
            .max_connections(1)
            .connect_lazy("postgres://postgres:password@localhost/test_db")
            .expect("Failed to create mock pool");

        AppState {
            config: Arc::new(Config::new_testing()),
            db,
            jwt_args: JwtValidationArgs::new_testing(),
            internal_api_secret: LocalOrRemoteSecret::Local(InternalApiSecretKey::Comptime(
                "testing",
            )),
            contacts_service: Arc::new(MockService),
        }
    }
}
