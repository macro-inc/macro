use crate::config::Config;
use axum::extract::FromRef;
use frecency::{
    domain::services::EventIngestorImpl,
    inbound::polling_aggregator::FrecencyAggregatorWorkerHandle,
    outbound::postgres::FrecencyPgStorage,
};
use last_online_tracker::inbound::LastOnlineWorker;
use macro_authorization::{
    MacroAuthJwtValidator, MacroAuthorizationServiceImpl, MacroAuthorizationState,
};
use redis::{RedisError, aio::MultiplexedConnection};
use std::sync::Arc;
use stream::domain::StreamManager;

pub type AuthorizationService = MacroAuthorizationServiceImpl<MacroAuthJwtValidator>;

#[derive(Clone, FromRef)]
pub struct ApiContext {
    pub connection_manager: crate::service::connection::ConnectionManager,
    pub frecency_ingestor_service: EventIngestorImpl<FrecencyPgStorage>,
    pub redis_client: Arc<redis::Client>,
    pub redis_connection: MultiplexedConnection,
    pub stream_manager: Arc<dyn StreamManager + Send + Sync>,
    pub last_online_worker: Arc<LastOnlineWorker>,
}

impl ApiContext {
    pub fn get_multiplexed_async_connection(&self) -> Result<MultiplexedConnection, RedisError> {
        Ok(self.redis_connection.clone())
    }
}

#[derive(Clone, FromRef)]
pub struct AppState {
    pub context: ApiContext,
    pub config: Arc<Config>,
    pub authorization_state: MacroAuthorizationState<AuthorizationService>,
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
