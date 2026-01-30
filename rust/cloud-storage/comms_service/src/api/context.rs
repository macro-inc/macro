use axum_macros::FromRef;
use comms::{
    domain::service::ChannelServiceImpl,
    inbound::CommsRouterState,
    outbound::{http::user_repo::UserRepoImpl, postgres::comms_repo::PgCommsRepo},
};
use connection_gateway_client::client::ConnectionGatewayClient;
use frecency::outbound::postgres::FrecencyPgStorage;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_env_var::env_var;
use secretsmanager_client::LocalOrRemoteSecret;
use sqlx::PgPool;
use std::sync::Arc;

env_var! {
    #[derive(Clone)]
    pub struct DocumentPermissionJwtSecretKey;
}

#[derive(Clone, FromRef)]
pub struct AppState {
    pub jwt_validation_args: JwtValidationArgs,
    pub db: PgPool,
    pub connection_gateway_client: Arc<ConnectionGatewayClient>,
    pub macro_notify_client: Arc<macro_notify::MacroNotify>,
    pub sqs_client: Arc<sqs_client::SQS>,
    pub permissions_token_secret: LocalOrRemoteSecret<DocumentPermissionJwtSecretKey>,
    pub frecency_storage: FrecencyPgStorage,
    pub comms_state: CommsRouterState<ChannelImpl>,
}

pub type ChannelImpl = ChannelServiceImpl<PgCommsRepo, UserRepoImpl, FrecencyPgStorage>;
