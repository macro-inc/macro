use crate::pubsub::context::CrmServiceType;
use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use gmail_client::GmailClient;
use sqlx::PgPool;
use sqs_client::SQS;

#[derive(Clone)]
pub struct LinkManagerContext {
    pub db: PgPool,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub gmail_client: GmailClient,
    pub auth_service_client: AuthServiceClient,
    pub redis_client: RedisClient,
    pub sqs_client: SQS,
    pub crm_service: CrmServiceType,
    pub connection_gateway_client: ConnectionGatewayClient,
}
