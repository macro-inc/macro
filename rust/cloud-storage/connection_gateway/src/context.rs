use crate::config::Config;
use axum::extract::FromRef;
use frecency::{
    domain::services::EventIngestorImpl,
    inbound::polling_aggregator::FrecencyAggregatorWorkerHandle,
    outbound::postgres::FrecencyPgStorage,
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::internal_access::InternalApiSecretKey;
use redis::{RedisError, aio::MultiplexedConnection};
use secretsmanager_client::LocalOrRemoteSecret;
use std::sync::Arc;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub connection_manager: crate::service::connection::ConnectionManager,
    pub frecency_ingestor_service: EventIngestorImpl<FrecencyPgStorage>,
    pub redis_client: Arc<redis::Client>,
}

impl ApiContext {
    #[tracing::instrument(err, skip(self))]
    pub async fn get_multiplexed_tokio_connection(
        &self,
    ) -> Result<MultiplexedConnection, RedisError> {
        self.redis_client.get_multiplexed_tokio_connection().await
    }
}

#[derive(Clone, FromRef)]
pub struct AppState {
    pub context: ApiContext,
    pub config: Arc<Config>,
    pub jwt_args: JwtValidationArgs,
    pub internal_auth_key: LocalOrRemoteSecret<InternalApiSecretKey>,
    pub frecency_worker: Arc<FrecencyAggregatorWorkerHandle>,
}

impl AsRef<ApiContext> for AppState {
    fn as_ref(&self) -> &ApiContext {
        &self.context
    }
}

impl AsRef<Config> for AppState {
    fn as_ref(&self) -> &Config {
        &self.config
    }
}
