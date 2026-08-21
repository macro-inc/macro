use crate::outbound::email_api::GmailApi;
use crate::pubsub::context::{CrmServiceType, NotificationIngressType, PubSubEventBroker};
use crate::util::redis::RedisClient;
use authentication_service_client::AuthServiceClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use sqlx::PgPool;
use sqs_client::SQS;
use std::sync::Arc;

#[derive(Clone)]
pub struct LinkManagerContext {
    pub db: PgPool,
    pub sqs_worker: sqs_worker::SQSWorker,
    pub email_api: GmailApi,
    pub auth_service_client: AuthServiceClient,
    pub redis_client: RedisClient,
    pub sqs_client: SQS,
    pub crm_service: CrmServiceType,
    pub connection_gateway_client: ConnectionGatewayClient,
    pub notification_ingress_service: Arc<NotificationIngressType>,
    pub macro_event_broker: PubSubEventBroker,
}
